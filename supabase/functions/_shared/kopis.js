// 아이 공연 — 공연예술통합전산망(KOPIS) 오픈API. 키: KOPIS_KEY (kopis.or.kr → OPEN API → 인증키 발급신청)
//  1) 공연목록 pblprfr: 지금 공연 중인 아동공연(kidstate=Y)
//  2) 예매상황판 boxoffice: 지난 7일 예매 순위(아동). 순위에 있는 공연은 🎟 예매 n위로 표시하고 위로 올려요.
// 응답은 XML이라 필요한 태그만 꺼내요. 키는 로그·결과에 남기지 않아요.

const BASE = 'http://www.kopis.or.kr/openApi/restful';
const T = 20000;
const tag = (x, t) => { const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(x); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''; };
const rows = (xml, t) => [...String(xml).matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'g'))].map((m) => m[1]);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const dot = (s) => String(s || '').replace(/\./g, '').slice(0, 8);
// KOPIS 지역 글자('서울특별시', '경기', '전북특별자치도' …) → 앱의 지역 파일
const AREA = [[/서울/, 'sg', '서울'], [/경기/, 'sg', '경기'], [/인천/, 'incheon', '인천'], [/강원/, 'gangwon', '강원'], [/대전/, 'chung', '대전'], [/세종/, 'chung', '세종'],
  [/충청북|충북/, 'chung', '충북'], [/충청남|충남/, 'chung', '충남'], [/광주/, 'jeolla', '광주'], [/전라북|전북/, 'jeolla', '전북'], [/전라남|전남/, 'jeolla', '전남'],
  [/부산/, 'gyeong', '부산'], [/대구/, 'gyeong', '대구'], [/울산/, 'gyeong', '울산'], [/경상북|경북/, 'gyeong', '경북'], [/경상남|경남/, 'gyeong', '경남'], [/제주/, 'jeju', '제주']];
const areaOf = (s) => AREA.find(([re]) => re.test(s || '')) || null;

async function get(op, params) {
  const res = await fetch(`${BASE}/${op}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(T) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${op} HTTP ${res.status}`);
  const code = tag(text, 'returncode') || tag(text, 'resultCode');
  if (/SERVICE KEY IS NOT REGISTERED|^02$/.test(code + tag(text, 'errmsg'))) throw new Error('KOPIS 키가 등록되지 않았어요');
  return text;
}

export async function kidsShows(key, now = new Date()) {
  if (!key) return null;
  const today = ymd(now);
  const later = ymd(new Date(now.getTime() + 30 * 864e5));
  // 1) 지금 공연 중인 아동공연(최대 500건)
  const list = new Map();
  for (let page = 1; page <= 5; page++) {
    const xml = await get('pblprfr', { service: key, stdate: today, eddate: later, cpage: String(page), rows: '100', kidstate: 'Y', prfstate: '02' });
    const items = rows(xml, 'db');
    for (const x of items) {
      const id = tag(x, 'mt20id'); const a = areaOf(tag(x, 'area'));
      if (!id || !a) continue;
      list.set(id, {
        id: 'kopis-' + id, show: true, name: tag(x, 'prfnm'), start: dot(tag(x, 'prfpdfrom')), end: dot(tag(x, 'prfpdto')),
        venue: tag(x, 'fcltynm'), genre: tag(x, 'genrenm'), area: a[1], region: a[2], image: tag(x, 'poster').replace(/^http:/, 'https:'),
        openrun: tag(x, 'openrun') === 'Y',
        homepage: `https://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do?menuId=MNU_00020&mt20Id=${id}`,
      });
    }
    if (items.length < 100) break;
  }
  // 2) 지난 7일 예매 순위(아동). 순위 API가 실패해도 목록은 그대로 써요.
  let ranked = 0;
  try {
    const xml = await get('boxoffice', { service: key, stdate: ymd(new Date(now.getTime() - 7 * 864e5)), eddate: ymd(new Date(now.getTime() - 864e5)), catecode: 'KID' });
    for (const x of rows(xml, 'boxof')) {
      const id = tag(x, 'mt20id'); const rank = Number(tag(x, 'rnum')) || 0;
      const s = list.get(id);
      if (s && rank) { s.rank = rank; ranked++; }
    }
  } catch { /* 순위 없이 */ }
  const shows = [...list.values()].sort((a, b) => (a.rank || 999) - (b.rank || 999) || a.end.localeCompare(b.end));
  return { fetchedAt: now.toISOString(), source: '공연예술통합전산망(KOPIS)', ranked, shows };
}
