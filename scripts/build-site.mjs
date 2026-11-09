// 배포용 사이트 만들기: node scripts/build-site.mjs [출력 폴더=site]
//  1) dist/ 를 그대로 복사
//  2) 지역별 인기 장소를 공공데이터로 만들어 data/discover-<지역>.json 으로 저장
//     — 공공데이터 응답이 느려(호출당 최대 30초) 앱이 아니라 여기(GitHub Actions)서 미리 만들어요.
//     — 이전에 배포한 파일(SITE_URL)과 합쳐서, 서버가 불안정한 날에도 목록이 줄지 않게 해요.
// 환경 변수: TOUR_API_KEY(없으면 이전 데이터만 이어 받기), SITE_URL(예: https://아이디.github.io/weekend-outing)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkKey, discover, mergeDiscover } from '../supabase/functions/_shared/tour.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.resolve(root, process.argv[2] || 'site');
const KEY = process.env.TOUR_API_KEY || '';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');
// 서울·경기·전국은 'sg' 파일 하나로(앱이 지역으로 다시 걸러요). 나머지 지역은 각자 파일.
export const DATA_REGIONS = ['sg', 'incheon', 'gangwon', 'chung', 'jeolla', 'gyeong', 'jeju'];
const hide = (s) => (KEY ? String(s).split(KEY).join('***') : String(s));

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
  await fs.writeFile(path.join(out, 'data', `discover-${region}.json`), JSON.stringify(body));
  summary.push(`${region}: ${body.places.length}곳, 위치 ${body.places.filter((p) => p.lat != null).length}곳, ${Math.round((Date.now() - started) / 1000)}초${body === prev ? ' (이전 데이터)' : ''}`);
}
await fs.writeFile(path.join(out, 'data', 'index.json'), JSON.stringify({ builtAt: new Date().toISOString(), regions: DATA_REGIONS, check, summary }));
console.log(summary.join('\n'));
