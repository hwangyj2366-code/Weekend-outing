// 배포용 사이트 만들기: node scripts/build-site.mjs [출력 폴더=site]
//  1) dist/ 를 그대로 복사
//  2) 지역별 인기 장소를 공공데이터로 만들어 data/discover-<지역>.json 으로 저장
//     — 공공데이터 응답이 느려(호출당 최대 30초) 앱이 아니라 여기(GitHub Actions)서 미리 만들어요.
//     — 이전에 배포한 파일(SITE_URL)과 합쳐서, 서버가 불안정한 날에도 목록이 줄지 않게 해요.
// 환경 변수: TOUR_API_KEY(없으면 이전 데이터만 이어 받기), SITE_URL(예: https://아이디.github.io/weekend-outing)
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkKey, crowd, discover, events, mergeDiscover } from '../supabase/functions/_shared/tour.js';
import { kidsShows } from '../supabase/functions/_shared/kopis.js';
import { enrichFoods, parseHundred } from '../supabase/functions/_shared/food-extra.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.resolve(root, process.argv[2] || 'site');
const KEY = process.env.TOUR_API_KEY || '';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');
// 서울·경기·전국은 'sg' 파일 하나로(앱이 지역으로 다시 걸러요). 나머지 지역은 각자 파일.
export const DATA_REGIONS = ['sg', 'incheon', 'gangwon', 'chung', 'jeolla', 'gyeong', 'jeju'];
// 맛집 보강용 키(없으면 그 단계만 건너뛰어요)
const EXTRA = { TOUR_API_KEY: KEY, KAKAO_REST_KEY: process.env.KAKAO_REST_KEY || '', NAVER_CLIENT_ID: process.env.NAVER_CLIENT_ID || '', NAVER_CLIENT_SECRET: process.env.NAVER_CLIENT_SECRET || '', KOPIS_KEY: process.env.KOPIS_KEY || '' };
const SECRETS = Object.values(EXTRA).filter((v) => v && v.length > 4);
const hide = (s) => SECRETS.reduce((t, k) => t.split(k).join('***'), String(s));
const HUNDRED = parseHundred(await fs.readFile(path.join(root, 'data-src', 'hundred-year.csv'), 'utf8').catch(() => ''));

async function previous(region) {
  if (!SITE_URL) return null;
  try {
    const res = await fetch(`${SITE_URL}/data/discover-${region}.json`, { signal: AbortSignal.timeout(15000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

await fs.rm(out, { recursive: true, force: true });
await fs.cp(path.join(root, 'dist'), out, { recursive: true });
await fs.mkdir(path.join(out, 'data'), { recursive: true });

// 키가 틀렸거나 공공데이터 서버에 닿지 않으면 모든 호출이 조용히 빈 결과가 되니, 먼저 한 번 확인해요.
// keyId: 키 자체가 아니라 길이와 해시 앞 8자리 — PC의 키와 같은 값이 들어갔는지 비교할 때만 써요.
const keyId = KEY ? `${KEY.length}자 #${createHash('sha256').update(KEY).digest('hex').slice(0, 8)}` : '';
const check = KEY ? hide(await checkKey(KEY)) : '키 없음';
console.log(`공공데이터 확인: ${check}`);
const summary = [];
for (const region of DATA_REGIONS) {
  const started = Date.now();
  const prev = await previous(region);
  let body = null;
  if (check === 'ok') {
    try { body = mergeDiscover(prev, await discover(KEY, region, true)); }
    catch (e) { console.warn(`[${region}] 만들기 실패: ${hide(e.message)}`); }
  }
  // 이번에 못 만들었으면 이전 파일을 그대로 이어 받아요(30일 넘은 건 버려요).
  if (body && !body.places.length && prev?.places?.length) body = null; // 빈 결과로 덮어쓰지 않기
  if (!body && prev && Date.now() - new Date(prev.fetchedAt).getTime() < 30 * 24 * 3600 * 1000) body = prev;
  if (!body) { summary.push(`${region}: 데이터 없음(앱은 기본 추천을 보여줘요)`); continue; }
  let extra = '';
  if (body !== prev) {
    try {
      const st = await enrichFoods(body, EXTRA, HUNDRED);
      extra = ` (네이버 ${EXTRA.NAVER_CLIENT_ID ? st.naverErr || st.naverCalls + '회, 체험·놀이·요즘 ' + st.spots + '곳, 블로그 ' + (st.blogErr || st.buzz + '곳') : '키 없음'}, 카카오 위치 ${EXTRA.KAKAO_REST_KEY ? st.kakaoErr || st.kakao + '곳' : '키 없음'}, 모범 ${st.modelErr || st.model + '곳'}, 백년가게 ${HUNDRED.length ? st.hundred + '곳' : '파일 없음'})`;
    } catch (e) { extra = ` (맛집 보강 실패: ${hide(e.message)})`; }
    // 이번 주말 붐빔 예상(관광지 집중률) — 서울·경기·인천만
    try {
      const c = await crowd(KEY, region, body.places);
      if (c.err || c.marked || c.added.length) extra += ` 붐빔 ${c.err || c.marked + '곳 표시, ' + c.added.length + '곳 추가'}`;
      const have = new Set(body.places.map((p) => p.name.replace(/s/g, '')));
      body.places.push(...c.added.filter((p) => !have.has(p.name.replace(/s/g, ''))));
    } catch (e) { extra += ` 붐빔 실패: ${hide(e.message).slice(0, 60)}`; }
  }
  await fs.writeFile(path.join(out, 'data', `discover-${region}.json`), JSON.stringify(body));
  summary.push(`${region}: ${body.places.length}곳, 맛집 ${(body.foods || []).length}곳${extra}, 위치 ${body.places.filter((p) => p.lat != null).length}곳, ${Math.round((Date.now() - started) / 1000)}초${body === prev ? ' (이전 데이터)' : ''}`);
}
// 행사 모아보기: 전국 행사 한 파일. 공식 사이트·소개글은 이전 파일에 있으면 다시 부르지 않아요(호출 한도 아끼기).
{
  const started = Date.now();
  let prev = null;
  if (SITE_URL) {
    try { const res = await fetch(`${SITE_URL}/data/events.json`, { signal: AbortSignal.timeout(15000) }); prev = res.ok ? await res.json() : null; } catch { /* 처음 */ }
  }
  let body = null;
  if (check === 'ok') {
    try { body = await events(KEY, prev); } catch (e) { console.warn(`[events] 만들기 실패: ${hide(e.message)}`); }
  }
  if (!body && prev && Date.now() - new Date(prev.fetchedAt).getTime() < 7 * 24 * 3600 * 1000) body = prev;
  // 아이 공연(KOPIS): 실패하면 이전 파일의 공연 목록을 이어 받아요.
  let kids = null;
  if (EXTRA.KOPIS_KEY) { try { kids = await kidsShows(EXTRA.KOPIS_KEY); } catch (e) { console.warn(`[kopis] ${hide(e.message)}`); } }
  if (body) {
    if (kids) Object.assign(body, { shows: kids.shows, showsAt: kids.fetchedAt, showsRanked: kids.ranked });
    else if (prev && prev.shows && body !== prev) Object.assign(body, { shows: prev.shows, showsAt: prev.showsAt, showsRanked: prev.showsRanked });
    await fs.writeFile(path.join(out, 'data', 'events.json'), JSON.stringify(body));
    summary.push(`events: ${body.events.length}건, 사이트 ${body.events.filter((e) => e.homepage).length}건, 아이 공연 ${EXTRA.KOPIS_KEY ? (body.shows || []).length + '건(예매 순위 ' + (body.showsRanked || 0) + ')' : '키 없음'}, ${Math.round((Date.now() - started) / 1000)}초${body === prev ? ' (이전 데이터)' : ''}`);
  } else summary.push('events: 데이터 없음');
}
await fs.writeFile(path.join(out, 'data', 'index.json'), JSON.stringify({ builtAt: new Date().toISOString(), regions: DATA_REGIONS, check, keyId, summary }));
console.log(summary.join('\n'));
