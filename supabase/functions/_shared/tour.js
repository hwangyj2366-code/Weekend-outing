// 인기 나들이 장소 — 한국관광공사 공공데이터 (Supabase Edge Function과 로컬 서버가 함께 사용)
//
// '인기' 기준 (점수가 높은 순, 카드에 근거와 기준일을 함께 표시)
//  1) 이번 주말 진행 중인 축제·행사        — 국문 관광정보 searchFestival2 (조회일 기준, 가장 최신)
//  2) 티맵 이동 데이터 연관 관광지 순위     — 관광지별 연관 관광지 TarRlteTarService1 (월 단위 기준월)
//     시군구마다 '함께 많이 찾은 관광지' 순위에 몇 번, 몇 위로 나왔는지로 점수를 매겨요.
//  3) 관광정보 등록 장소 (순위 데이터가 없는 지역) — 인기 근거 없음으로 표시
// 운영 정보(이용시간·쉬는 날·문의)는 국문 관광정보 detailIntro2 에서 가져와 출처·수정일과 함께 보여줘요.

const APP = 'WeekendOuting';
const RLTE = 'https://apis.data.go.kr/B551011/TarRlteTarService1';
const KOR = 'https://apis.data.go.kr/B551011/KorService2';
const CACHE_MS = 12 * 60 * 60 * 1000;
// 공공데이터포털 응답이 30초 가까이 걸릴 때가 있어 넉넉히 기다려요(전체 계산은 백그라운드에서 몇 분 걸려요).
const CALL_MS = 45000;

// 시군구 코드(법정동 기준). 인기 순위는 이 목록이 있는 지역만 계산해요.
const SIGNGU = {
  '11': ['11110', '11140', '11170', '11200', '11215', '11230', '11260', '11290', '11305', '11320', '11350', '11380', '11410', '11440', '11470', '11500', '11530', '11545', '11560', '11590', '11620', '11650', '11680', '11710', '11740'],
  '41': ['41110', '41130', '41150', '41170', '41190', '41210', '41220', '41250', '41270', '41280', '41290', '41310', '41360', '41370', '41390', '41410', '41430', '41450', '41460', '41480', '41500', '41550', '41570', '41590', '41610', '41630', '41650', '41670', '41800', '41820', '41830'],
  '28': ['28110', '28140', '28177', '28185', '28200', '28237', '28245', '28260', '28710', '28720'],
};
export const REGION = {
  sg: ['11', '41'], seoul: ['11'], gyeonggi: ['41'], incheon: ['28'], gangwon: ['51'],
  chung: ['30', '36', '43', '44'], jeolla: ['29', '52', '46'], gyeong: ['26', '27', '31', '47', '48'], jeju: ['50'],
  all: ['11', '41', '28'],
};
const PROV = {
  '11': '서울', '26': '부산', '27': '대구', '28': '인천', '29': '광주', '30': '대전', '31': '울산', '36': '세종',
  '41': '경기', '43': '충북', '44': '충남', '46': '전남', '47': '경북', '48': '경남', '50': '제주', '51': '강원', '52': '전북',
};

// 아이와 가기 어려운 곳은 인기 목록에서 뺍니다. (분류 자체는 앱의 core.js가 다시 합니다)
const NOT_FOR_KIDS = /골프|컨트리클럽|카지노|면세|백화점|아울렛|쇼핑|몰$|몰 |시장|거리$|터미널|공항|역$|모텔|술|와인|맥주|막걸리|양조|주류|나이트|클럽$/;
const ENV = { '캠핑장': '야외', '과학관': '실내', '박물관': '실내', '자연·공원': '야외', '체험·놀이': '실내', '여행지': '야외', '축제·행사': '야외' };
const RULES = [
  ['캠핑장', /캠핑|야영|글램핑|오토캠/],
  ['과학관', /과학관|천문|사이언스|과학원/],
  ['박물관', /박물관|미술관|기념관|역사관|전시관|뮤지엄/],
  ['자연·공원', /공원|수목원|식물원|동물원|휴양림|숲|생태|습지|농장|목장/],
  ['체험·놀이', /키즈|어린이|체험|놀이|상상나라|아쿠아리움|테마파크|랜드|월드|썰매|레일바이크/],
  ['여행지', /궁$|궁궐|성곽|한옥마을|전망대|타워|해변|해수욕장|섬$|폭포|케이블카|스카이워크|둘레길|호수|마을|정원/],
];
const classify = (name) => (RULES.find(([, re]) => re.test(name)) || [])[0] || null;

export class GatewayError extends Error {}

async function call(key, base, op, params) {
  const q = new URLSearchParams({ serviceKey: key, MobileOS: 'ETC', MobileApp: APP, _type: 'json', pageNo: '1', numOfRows: '50', ...params });
  const res = await fetch(`${base}/${op}?${q}`, { signal: AbortSignal.timeout(CALL_MS) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${op}: JSON이 아닌 응답`); }
  // 공공데이터포털 게이트웨이 오류 (04 = 제공기관 서버 응답 없음, 30 = 등록되지 않은 키, 22 = 호출 한도 초과)
  const gw = json?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gw) throw new GatewayError(`${op}: ${gw.returnReasonCode} ${gw.errMsg}`);
  if (!res.ok) throw new Error(`${op} HTTP ${res.status}`);
  const code = json?.response?.header?.resultCode;
  if (code && code !== '0000' && code !== '00') throw new Error(`${op}: ${json.response.header.resultMsg}`);
  const items = json?.response?.body?.items?.item ?? json?.response?.body?.items ?? [];
  return Array.isArray(items) ? items : items && typeof items === 'object' ? [items] : [];
}

// 키·접속 확인용 한 번 호출. pool()은 개별 실패를 삼키므로, 전부 실패하는 경우를 여기서 먼저 잡아요.
export async function checkKey(key) {
  try { await call(key, KOR, 'areaBasedList2', { lDongRegnCd: '11', contentTypeId: '14', numOfRows: '1' }); return 'ok'; }
  catch (e) { return String(e?.message ?? e); }
}

async function pool(list, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) {
      const x = list[i++];
      // 일부 시군구는 제공기관 서버가 간헐적으로 04 오류를 내요. 한 곳 실패는 건너뛰고 나머지로 계산합니다.
      try { out.push(await fn(x)); } catch { /* 건너뜀 */ }
    }
  }));
  return out;
}

const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const dash = (s) => (String(s || '').length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');
const strip = (s) => String(s ?? '').replace(/<br\s*\/?>/gi, ' / ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const https = (u) => (u ? String(u).replace(/^http:/, 'https:') : undefined);
function regionOf(addr, prov) {
  const w = String(addr || '').split(/\s+/);
  const city = w.find((x, i) => i > 0 && /(시|군|구)$/.test(x));
  return [prov, city && city.replace(/시$/, '')].filter(Boolean).join(' ');
}
// 한국 시간 기준 다가오는(또는 오늘이 포함된) 토·일
export function weekendOf(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const dow = kst.getUTCDay();
  const sat = new Date(kst); sat.setUTCDate(kst.getUTCDate() + (dow === 0 ? -1 : 6 - dow));
  const sun = new Date(sat); sun.setUTCDate(sat.getUTCDate() + 1);
  return { sat: ymd(sat), sun: ymd(sun), today: ymd(kst) };
}

let baseYmMemo = null;
async function latestBaseYm(key) {
  if (baseYmMemo && Date.now() - baseYmMemo.at < CACHE_MS) return baseYmMemo.value;
  const d = new Date(); d.setUTCDate(1);
  for (let k = 1; k <= 30; k++) {
    const t = new Date(d); t.setUTCMonth(d.getUTCMonth() - k);
    const ym = ymd(t).slice(0, 6);
    // 게이트웨이 오류는 다른 달을 물어봐도 같으니 바로 실패(데이터 없음만 이전 달로).
    const items = await call(key, RLTE, 'areaBasedList1', { baseYm: ym, areaCd: '11', signguCd: '11110', numOfRows: '1' })
      .catch((e) => { if (e instanceof GatewayError || e.name === 'TimeoutError') throw e; return []; });
    if (items.length) { baseYmMemo = { value: ym, at: Date.now() }; return ym; }
  }
  return null;
}

async function intro(key, contentId, typeId) {
  const [it] = await call(key, KOR, 'detailIntro2', { contentId, contentTypeId: typeId });
  if (!it) return null;
  const pick = (...k) => strip(k.map((x) => it[x]).find((v) => strip(v)));
  return {
    usetime: pick('usetime', 'usetimeculture', 'usetimeleports', 'playtime', 'usetimefestival', 'openperiod'),
    restdate: pick('restdate', 'restdateculture', 'restdateleports'),
    infocenter: pick('infocenter', 'infocenterculture', 'infocenterleports', 'sponsor1tel'),
    reservation: pick('reservation', 'reservationlodging', 'bookingplace'),
    usefee: pick('usefee', 'usetimefestival', 'usefeeleports'),
    parking: pick('parking', 'parkingculture', 'parkingleports'),
    babycarriage: pick('chkbabycarriage', 'chkbabycarriageculture', 'chkbabycarriageleports'),
  };
}
async function enrich(key, p, prov) {
  const found = await call(key, KOR, 'searchKeyword2', { keyword: p.name, lDongRegnCd: prov, numOfRows: '5' }).catch(() => []);
  const hit = found.find((x) => String(x.title ?? '').replace(/\s/g, '') === p.name.replace(/\s/g, '')) ?? found[0];
  if (!hit) return;
  if (hit.addr1) p.region = regionOf(hit.addr1, PROV[prov]) || p.region;
  if (hit.firstimage) p.image = https(hit.firstimage);
  if (hit.mapy && hit.mapx) { p.lat = Number(hit.mapy); p.lng = Number(hit.mapx); }
  const info = await intro(key, String(hit.contentid), String(hit.contenttypeid)).catch(() => null);
  if (info) p.hours = { ...info, source: '한국관광공사 국문 관광정보', updated: dash(hit.modifiedtime) };
}

async function popular(key, provs) {
  const base = await latestBaseYm(key);
  if (!base) return { places: [], basis: null };
  const jobs = provs.flatMap((p) => (SIGNGU[p] ?? []).map((s) => ({ p, s })));
  const lists = await pool(jobs, 8, async ({ p, s }) => ({ p, items: await call(key, RLTE, 'areaBasedList1', { baseYm: base, areaCd: p, signguCd: s }) }));
  const map = new Map();
  for (const { p, items } of lists) {
    for (const it of items) {
      const name = String(it.rlteTatsNm ?? '').trim();
      const ctg = String(it.rlteCtgryLclsNm ?? '');
      if (!name || NOT_FOR_KIDS.test(name) || (ctg && /음식|숙박|쇼핑/.test(ctg))) continue;
      const category = classify(name);
      if (!category) continue;
      const rank = Number(it.rlteRank ?? 50) || 50;
      const k = name.replace(/\s/g, '');
      const cur = map.get(k);
      if (cur) { cur.hits++; cur.best = Math.min(cur.best, rank); continue; }
      map.set(k, {
        name, prov: p, category, hits: 1, best: rank,
        region: [PROV[p], String(it.rlteSignguNm ?? '').replace(/시$/, '')].filter(Boolean).join(' '),
      });
    }
  }
  const basis = `${base.slice(0, 4)}-${base.slice(4)}`;
  const places = [...map.values()]
    .map((x) => ({ ...x, score: x.hits * 10 + (51 - x.best) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
    .map((x) => ({
      id: 'rlte-' + x.name.replace(/\s/g, ''), name: x.name, region: x.region, category: x.category, env: ENV[x.category], url: '',
      note: '티맵 이동 데이터에서 주변 관광지와 함께 많이 찾은 곳이에요.',
      popularity: { kind: 'tmap', label: `연관 관광지 순위 ${x.hits}회 등장 · 최고 ${x.best}위`, source: '한국관광공사 관광지별 연관 관광지(티맵)', basis, score: x.score },
      _prov: x.prov,
    }));
  await pool(places, 6, (pl) => enrich(key, pl, pl._prov)); // 거리·지도 표시용 위치와 운영 정보
  places.forEach((pl) => delete pl._prov);
  return { places, basis };
}

async function festivals(key, provs) {
  const w = weekendOf();
  const from = new Date(); from.setUTCDate(from.getUTCDate() - 60);
  const out = [];
  await pool(provs, 4, async (p) => {
    const items = await call(key, KOR, 'searchFestival2', { eventStartDate: ymd(from), lDongRegnCd: p, numOfRows: '100', arrange: 'Q' });
    for (const it of items) {
      const s = String(it.eventstartdate ?? ''), e = String(it.eventenddate ?? '');
      const name = strip(it.title);
      if (!name || !s || !e || s > w.sun || e < w.sat || NOT_FOR_KIDS.test(name)) continue;
      out.push({
        id: 'fest-' + it.contentid, name, category: '축제·행사', env: '야외', url: '',
        region: regionOf(it.addr1, PROV[p]), image: https(it.firstimage), lat: Number(it.mapy) || null, lng: Number(it.mapx) || null,
        note: `${dash(s)} ~ ${dash(e)} 진행`,
        popularity: { kind: 'festival', label: '이번 주말 열리는 행사', source: '한국관광공사 행사정보', basis: `${dash(w.sat)} 주말`, score: 100 },
        hours: { usetime: `${dash(s)} ~ ${dash(e)}`, restdate: '', infocenter: strip(it.tel), reservation: '', source: '한국관광공사 행사정보', updated: dash(it.modifiedtime) },
      });
    }
  });
  const top = out.slice(0, 12);
  // 행사 공식 사이트 — 공통정보 homepage는 '공식 홈페이지 https://…' 같은 글이나 <a> 태그라 첫 주소만 꺼내요.
  await pool(top, 6, async (f) => {
    const [it] = await call(key, KOR, 'detailCommon2', { contentId: f.id.replace('fest-', '') });
    const url = (/https?:\/\/[^\s"'<>]+/.exec(String(it?.homepage ?? '')) || [])[0];
    if (url) f.homepage = url.replace(/[.,)]+$/, '');
  });
  return top;
}

// 행사 화면용: 오늘부터 다음 달 말까지 열리는 전국 축제·행사(이미 시작해 진행 중인 것 포함).
// 공식 사이트·소개글은 행사마다 한 번 더 불러야 해서, 이전 결과(prev)에 있으면 그대로 쓰고 새 행사만 최대 maxDetail건 불러요.
const AREA_OF = Object.fromEntries(['sg', 'incheon', 'gangwon', 'chung', 'jeolla', 'gyeong', 'jeju'].flatMap((a) => REGION[a].map((p) => [p, a])));
export async function events(key, prev = null, maxDetail = 120) {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const today = ymd(now);
  const end = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0)));
  const from = new Date(now); from.setUTCDate(from.getUTCDate() - 120);
  const seen = new Set(); const out = []; const errors = [];
  await Promise.all(Object.keys(PROV).map(async (p) => {
    const items = await call(key, KOR, 'searchFestival2', { eventStartDate: ymd(from), lDongRegnCd: p, numOfRows: '500', arrange: 'A' })
      .catch((e) => { errors.push(`${PROV[p]}: ${e.message}`); return []; });
    for (const it of items) {
      const s = String(it.eventstartdate ?? ''), e = String(it.eventenddate ?? '');
      const name = strip(it.title);
      if (!name || !s || !e || s > end || e < today || NOT_FOR_KIDS.test(name) || seen.has(it.contentid)) continue;
      seen.add(it.contentid);
      out.push({
        id: String(it.contentid), name, start: s, end: e, prov: p, area: AREA_OF[p], region: regionOf(it.addr1, PROV[p]),
        addr: strip(it.addr1), image: https(it.firstimage), lat: Number(it.mapy) || null, lng: Number(it.mapx) || null, tel: strip(it.tel),
      });
    }
  }));
  if (!out.length && errors.length) throw new Error(errors.join(' / '));
  const old = new Map((prev?.events || []).map((x) => [x.id, x]));
  const todo = [];
  for (const ev of out) {
    const o = old.get(ev.id);
    if (o && o.detailAt) Object.assign(ev, { homepage: o.homepage, overview: o.overview, detailAt: o.detailAt });
    else todo.push(ev);
  }
  // 가까운 날짜에 시작하는 행사부터 상세 정보를 채워요.
  todo.sort((a, b) => a.start.localeCompare(b.start));
  await pool(todo.slice(0, maxDetail), 6, async (ev) => {
    const [it] = await call(key, KOR, 'detailCommon2', { contentId: ev.id });
    const url = (/https?:\/\/[^\s"'<>]+/.exec(String(it?.homepage ?? '')) || [])[0];
    if (url) ev.homepage = url.replace(/[.,)]+$/, '');
    const ov = strip(it?.overview);
    if (ov) ev.overview = ov.length > 180 ? ov.slice(0, 180) + '…' : ov;
    ev.detailAt = today;
  });
  out.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  return { fetchedAt: new Date().toISOString(), today, until: end, source: '한국관광공사 행사정보', errors, events: out };
}

async function listed(key, provs) {
  const out = [];
  await pool(provs.flatMap((p) => ['12', '14'].map((t) => ({ p, t }))), 6, async ({ p, t }) => {
    const items = await call(key, KOR, 'areaBasedList2', { lDongRegnCd: p, contentTypeId: t, arrange: 'Q', numOfRows: '60' });
    for (const it of items) {
      const name = strip(it.title); const category = classify(name);
      if (!category || NOT_FOR_KIDS.test(name)) continue;
      out.push({
        id: 'kto-' + it.contentid, name, category, env: ENV[category], url: '',
        region: regionOf(it.addr1, PROV[p]), image: https(it.firstimage), lat: Number(it.mapy) || null, lng: Number(it.mapx) || null,
        note: '한국관광공사 관광정보에 등록된 곳이에요. (인기 순위 정보 없음)',
        hours: { usetime: '', restdate: '', infocenter: '', reservation: '', source: '한국관광공사 국문 관광정보', updated: dash(it.modifiedtime) },
      });
    }
  });
  return out.slice(0, 40);
}

const memo = new Map();
export async function discover(key, region = 'sg', force = false) {
  if (!key) { const e = new Error('TOUR_API_KEY가 설정되지 않았어요.'); e.status = 503; throw e; }
  const provs = REGION[region] ?? REGION.sg;
  const hit = memo.get(region);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  const withRank = provs.filter((p) => SIGNGU[p]);
  const rest = provs.filter((p) => !SIGNGU[p]);
  const settle = (pr) => pr.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
  const [pop, fest, other] = await Promise.all([
    settle(withRank.length ? popular(key, withRank) : Promise.resolve({ places: [], basis: null })),
    settle(festivals(key, provs)),
    settle(rest.length ? listed(key, rest) : Promise.resolve([])),
  ]);
  const errors = [pop, fest, other].filter((r) => !r.ok).map((r) => String(r.e?.message ?? r.e));
  const places = [...(fest.ok ? fest.v : []), ...(pop.ok ? pop.v.places : []), ...(other.ok ? other.v : [])];
  if (!places.length && errors.length) { const e = new Error(errors.join(' / ')); e.status = 502; throw e; }
  const basis = pop.ok ? pop.v.basis : null;
  const stale = basis && (Date.now() - new Date(basis + '-01').getTime()) > 400 * 24 * 3600 * 1000;
  const body = {
    region, fetchedAt: new Date().toISOString(), weekend: weekendOf(),
    popularityNote: [
      fest.ok && fest.v.length ? `이번 주말 행사 ${fest.v.length}건(한국관광공사 행사정보)` : '',
      basis ? `티맵 연관 관광지 순위 ${basis} 기준${stale ? '(공개된 가장 최근 자료)' : ''}` : '',
      rest.length ? '일부 지역은 순위 데이터가 없어 관광정보 등록 장소' : '',
    ].filter(Boolean).join(' · '),
    errors,
    places,
  };
  memo.set(region, { at: Date.now(), body });
  return body;
}

// 공공데이터 서버가 불안정하면 이번 결과가 적게 나올 수 있어요. 이전 결과와 합쳐(이번 것 우선) 목록이 줄지 않게 하고,
// 같은 장소는 비어 있는 위치·운영 정보를 이전 결과로 채워요. maxAgeDays보다 오래된 이전 결과는 버려요.
export function mergeDiscover(prev, body, maxAgeDays = 7) {
  if (!prev || !Array.isArray(prev.places) || Date.now() - new Date(prev.fetchedAt).getTime() > maxAgeDays * 24 * 3600 * 1000) return body;
  const key = (p) => String(p.name).replace(/\s/g, '');
  const old = new Map(prev.places.map((p) => [key(p), p]));
  const places = body.places.map((p) => {
    const o = old.get(key(p));
    return o ? { ...o, ...p, lat: p.lat ?? o.lat, lng: p.lng ?? o.lng, image: p.image || o.image, hours: p.hours || o.hours } : p;
  });
  const have = new Set(places.map(key));
  // 지난 행사(이번 주말과 겹치지 않는 축제)는 이어받지 않아요.
  const w = weekendOf();
  const keep = prev.places.filter((p) => !have.has(key(p)) && !(p.popularity && p.popularity.kind === 'festival' && p.popularity.basis !== `${w.sat.slice(0, 4)}-${w.sat.slice(4, 6)}-${w.sat.slice(6, 8)} 주말`));
  return { ...body, places: [...places, ...keep], popularityNote: body.popularityNote || prev.popularityNote };
}
