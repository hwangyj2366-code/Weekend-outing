// 주말에 어디가지? — 인기 나들이 장소 프록시 (Supabase Edge Function, Deno)
//
// 한국관광공사 공공데이터 2종을 서버에서 호출해 API 키가 화면 코드에 노출되지 않게 합니다.
//  1) 관광지별 연관 관광지 정보 (TarRlteTarService1/areaBasedList1)
//     — 티맵 이동 데이터 기반, 시군구별 중심 관광지와 함께 많이 찾은 관광지 순위. 인기의 근거로 사용.
//  2) 국문 관광정보 (KorService2: searchKeyword2 / areaBasedList2 / detailIntro2)
//     — 주소·사진·이용시간·쉬는 날·문의처. 운영 정보의 출처로 사용.
//
// 비밀값:  supabase secrets set TOUR_API_KEY=<공공데이터포털 일반 인증키(Decoding)>
// 배포:    supabase functions deploy discover --no-verify-jwt
// 호출:    GET /functions/v1/discover?region=sg

const KEY = Deno.env.get('TOUR_API_KEY') ?? '';
const APP = 'WeekendOuting';
const RLTE = 'https://apis.data.go.kr/B551011/TarRlteTarService1';
const KOR = 'https://apis.data.go.kr/B551011/KorService2';
const CACHE_MS = 12 * 60 * 60 * 1000;

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

// 시군구 코드(법정동 기준). 인기 순위는 이 목록이 있는 지역만 제공합니다.
const SIGNGU: Record<string, string[]> = {
  '11': ['11110', '11140', '11170', '11200', '11215', '11230', '11260', '11290', '11305', '11320', '11350', '11380', '11410', '11440', '11470', '11500', '11530', '11545', '11560', '11590', '11620', '11650', '11680', '11710', '11740'],
  '41': ['41110', '41130', '41150', '41170', '41190', '41210', '41220', '41250', '41270', '41280', '41290', '41310', '41360', '41370', '41390', '41410', '41430', '41450', '41460', '41480', '41500', '41550', '41570', '41590', '41610', '41630', '41650', '41670', '41800', '41820', '41830'],
  '28': ['28110', '28140', '28177', '28185', '28200', '28237', '28245', '28260', '28710', '28720'],
};
// 앱의 지역 id → 광역 법정동 코드
const REGION: Record<string, string[]> = {
  sg: ['11', '41'], seoul: ['11'], gyeonggi: ['41'], incheon: ['28'], gangwon: ['51'],
  chung: ['30', '36', '43', '44'], jeolla: ['29', '52', '46'], gyeong: ['26', '27', '31', '47', '48'], jeju: ['50'],
  all: ['11', '41', '28'],
};
const PROV: Record<string, string> = {
  '11': '서울', '26': '부산', '27': '대구', '28': '인천', '29': '광주', '30': '대전', '31': '울산', '36': '세종',
  '41': '경기', '43': '충북', '44': '충남', '46': '전남', '47': '경북', '48': '경남', '50': '제주', '51': '강원', '52': '전북',
};

// 아이 나들이 분류 (앱 core.js의 규칙을 축약)
const RULES: [string, RegExp][] = [
  ['제외', /골프|컨트리클럽|호텔|리조트|펜션|모텔|카지노|면세|시장|백화점|아울렛|쇼핑|거리$|역$|터미널|공항|성당|교회|사찰|절$|묘|능$|맛집|식당|카페/],
  ['캠핑장', /캠핑|야영|글램핑|오토캠/],
  ['과학관', /과학관|천문|사이언스|과학원/],
  ['박물관', /박물관|미술관|기념관|역사관|전시관|뮤지엄/],
  ['자연·공원', /공원|수목원|식물원|동물원|휴양림|숲|생태|습지|해수욕장|계곡|농장|목장/],
  ['체험·놀이', /키즈|어린이|체험|놀이|상상나라|아쿠아리움|테마파크|랜드|월드|썰매|레일바이크/],
];
const ENV: Record<string, string> = { '캠핑장': '야외', '과학관': '실내', '박물관': '실내', '자연·공원': '야외', '체험·놀이': '실내' };
function classify(name: string): string | null {
  for (const [cat, re] of RULES) if (re.test(name)) return cat === '제외' ? null : cat;
  return null;
}

type Item = Record<string, unknown>;
async function call(base: string, op: string, params: Record<string, string>): Promise<Item[]> {
  const q = new URLSearchParams({ serviceKey: KEY, MobileOS: 'ETC', MobileApp: APP, _type: 'json', pageNo: '1', numOfRows: '50', ...params });
  const res = await fetch(`${base}/${op}?${q}`, { signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${op} HTTP ${res.status}`);
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`${op}: JSON이 아닌 응답 (${text.slice(0, 80)})`); }
  const code = json?.response?.header?.resultCode;
  if (code && code !== '0000' && code !== '00') throw new Error(`${op}: ${json.response.header.resultMsg}`);
  const items = json?.response?.body?.items?.item ?? json?.response?.body?.items ?? [];
  return Array.isArray(items) ? items : items && typeof items === 'object' ? [items] : [];
}

async function pool<T, R>(list: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const x = list[i++]; try { out.push(await fn(x)); } catch { /* 한 지역 실패는 건너뜀 */ } }
  }));
  return out;
}

const ym = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
// 데이터가 있는 가장 최근 기준월 찾기 (최대 24개월 전까지)
let baseYmMemo: { value: string; at: number } | null = null;
async function latestBaseYm(): Promise<string | null> {
  if (baseYmMemo && Date.now() - baseYmMemo.at < CACHE_MS) return baseYmMemo.value;
  const d = new Date(); d.setUTCDate(1);
  for (let k = 1; k <= 24; k++) {
    const t = new Date(d); t.setUTCMonth(d.getUTCMonth() - k);
    const items = await call(RLTE, 'areaBasedList1', { baseYm: ym(t), areaCd: '11', signguCd: '11110', numOfRows: '1' }).catch(() => []);
    if (items.length) { baseYmMemo = { value: ym(t), at: Date.now() }; return ym(t); }
  }
  return null;
}

const strip = (s: unknown) => String(s ?? '').replace(/<br\s*\/?>/gi, ' / ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const fmtDate = (s: unknown) => { const v = String(s ?? ''); return v.length >= 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : ''; };
function regionOf(addr: string, prov: string) {
  const w = addr.split(/\s+/);
  const city = w.find((x, i) => i > 0 && /(시|군|구)$/.test(x));
  return [prov, city?.replace(/시$/, '')].filter(Boolean).join(' ');
}

async function introFor(contentId: string, typeId: string) {
  const [it] = await call(KOR, 'detailIntro2', { contentId, contentTypeId: typeId });
  if (!it) return null;
  const pickKey = (...k: string[]) => strip(k.map((x) => it[x]).find((v) => strip(v)));
  return {
    usetime: pickKey('usetime', 'usetimeculture', 'usetimeleports', 'openperiod'),
    restdate: pickKey('restdate', 'restdateculture', 'restdateleports'),
    infocenter: pickKey('infocenter', 'infocenterculture', 'infocenterleports'),
    reservation: pickKey('reservation', 'reservationlodging'),
  };
}

type Place = {
  id: string; name: string; region: string; category: string; env: string; note: string; url: string; image?: string;
  popularity?: { label: string; source: string; basis: string; score: number };
  hours?: Record<string, string>;
};

async function enrich(p: Place, prov: string) {
  const found = await call(KOR, 'searchKeyword2', { keyword: p.name, lDongRegnCd: prov, numOfRows: '5' }).catch(() => []);
  const hit = found.find((x) => String(x.title ?? '').replace(/\s/g, '') === p.name.replace(/\s/g, '')) ?? found[0];
  if (!hit) return;
  const addr = String(hit.addr1 ?? '');
  if (addr) p.region = regionOf(addr, PROV[prov] ?? '') || p.region;
  if (hit.firstimage) p.image = String(hit.firstimage).replace(/^http:/, 'https:');
  const intro = await introFor(String(hit.contentid), String(hit.contenttypeid)).catch(() => null);
  if (intro) p.hours = { ...intro, source: '한국관광공사 국문 관광정보(TourAPI)', updated: fmtDate(hit.modifiedtime) };
}

async function popular(provs: string[]) {
  const base = await latestBaseYm();
  if (!base) return { places: [] as Place[], base: null };
  const jobs = provs.flatMap((p) => (SIGNGU[p] ?? []).map((s) => ({ p, s })));
  const lists = await pool(jobs, 8, async ({ p, s }) => ({ p, items: await call(RLTE, 'areaBasedList1', { baseYm: base, areaCd: p, signguCd: s }) }));
  const map = new Map<string, Place & { prov: string; hits: number; best: number }>();
  for (const { p, items } of lists) {
    for (const it of items) {
      const name = String(it.rlteTatsNm ?? '').trim();
      const ctg = String(it.rlteCtgryLclsNm ?? '');
      if (!name || (ctg && !/관광지|문화|레포츠|자연|체험/.test(ctg))) continue;
      const category = classify(name);
      if (!category) continue;
      const rank = Number(it.rlteRank ?? 50) || 50;
      const signgu = String(it.rlteSignguNm ?? '');
      const k = name.replace(/\s/g, '');
      const cur = map.get(k);
      if (cur) { cur.hits++; cur.best = Math.min(cur.best, rank); continue; }
      map.set(k, {
        id: 'rlte-' + k, name, prov: String(it.rlteRegnCd ?? p).slice(0, 2) || p,
        region: [PROV[p], signgu.replace(/시$/, '')].filter(Boolean).join(' '),
        category, env: ENV[category], note: '', url: '', hits: 1, best: rank,
      });
    }
  }
  const basis = `${base.slice(0, 4)}-${base.slice(4)}`;
  const ranked = [...map.values()]
    .map((x) => ({ ...x, score: x.hits * 10 + (51 - x.best) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);
  const places: Place[] = ranked.map((x) => ({
    id: x.id, name: x.name, region: x.region, category: x.category, env: x.env, url: '',
    note: '티맵 이동 데이터에서 주변 관광지와 함께 많이 찾은 곳이에요.',
    popularity: {
      label: `연관 관광지 ${x.hits}개 시군구 순위 등장 · 최고 ${x.best}위`,
      source: '한국관광공사 관광지별 연관 관광지(티맵)', basis, score: x.score,
    },
    _prov: x.prov,
  } as Place & { _prov: string }));
  await pool(places.slice(0, 24), 6, (pl) => enrich(pl, (pl as any)._prov));
  places.forEach((pl) => delete (pl as any)._prov);
  return { places, base: basis };
}

// 인기 순위 시군구 목록이 없는 지역: 관광정보 등록 장소(인기 근거 없음)
async function listed(provs: string[]) {
  const out: Place[] = [];
  await pool(provs.flatMap((p) => ['12', '14'].map((t) => ({ p, t }))), 6, async ({ p, t }) => {
    const items = await call(KOR, 'areaBasedList2', { lDongRegnCd: p, contentTypeId: t, arrange: 'Q', numOfRows: '60' });
    for (const it of items) {
      const name = strip(it.title); const category = classify(name);
      if (!category) continue;
      out.push({
        id: 'kto-' + it.contentid, name, category, env: ENV[category], url: '',
        region: regionOf(String(it.addr1 ?? ''), PROV[p] ?? ''),
        image: it.firstimage ? String(it.firstimage).replace(/^http:/, 'https:') : undefined,
        note: '한국관광공사 관광정보에 등록된 곳이에요. (인기 순위 정보 없음)',
        hours: { usetime: '', restdate: '', infocenter: '', source: '한국관광공사 국문 관광정보(TourAPI)', updated: fmtDate(it.modifiedtime) },
      });
    }
  });
  return out.slice(0, 40);
}

const memo = new Map<string, { at: number; body: string }>();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
  if (!KEY) return json({ error: 'TOUR_API_KEY 비밀값이 설정되지 않았어요.' }, 503);

  const region = new URL(req.url).searchParams.get('region') ?? 'sg';
  const provs = REGION[region] ?? REGION.sg;
  const hit = memo.get(region);
  if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.body);

  try {
    const withRank = provs.filter((p) => SIGNGU[p]);
    const rest = provs.filter((p) => !SIGNGU[p]);
    const [pop, other] = await Promise.all([
      withRank.length ? popular(withRank) : Promise.resolve({ places: [] as Place[], base: null }),
      rest.length ? listed(rest) : Promise.resolve([] as Place[]),
    ]);
    const body = JSON.stringify({
      region, fetchedAt: new Date().toISOString(),
      popularityNote: pop.base
        ? `인기 근거: 한국관광공사 ‘관광지별 연관 관광지’(티맵 이동 데이터) ${pop.base} 기준.`
        : '이 지역은 인기 순위 데이터가 없어 관광정보 등록 장소를 보여드려요.',
      places: [...pop.places, ...other],
    });
    memo.set(region, { at: Date.now(), body });
    return json(body);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
});
