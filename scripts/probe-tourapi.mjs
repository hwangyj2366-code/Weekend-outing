// node scripts/probe-tourapi.mjs — .env.local의 TOUR_API_KEY로 한국관광공사 API 응답 구조를 확인해요.
// 키는 화면에 출력하지 않아요(오류 메시지 속 키도 가립니다).
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const bare = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').trim();
const KEY = env.TOUR_API_KEY || (/^[0-9a-f]{32,}$/i.test(bare) ? bare : '');
if (!KEY || /여기에/.test(KEY)) { console.error('.env.local에 TOUR_API_KEY가 없어요.'); process.exit(1); }
console.log(`키 길이 ${KEY.length}자, 형식: ${/^[0-9a-f]+$/i.test(KEY) ? '16진수' : /%/.test(KEY) ? 'Encoding(퍼센트 인코딩)' : '기타'}`);
const hide = (s) => String(s).split(KEY).join('***').split(encodeURIComponent(KEY)).join('***');

async function call(base, op, params) {
  const q = new URLSearchParams({ serviceKey: KEY, MobileOS: 'ETC', MobileApp: 'WeekendOuting', _type: 'json', pageNo: '1', numOfRows: '5', ...params });
  try {
    const res = await fetch(`https://apis.data.go.kr/B551011/${base}/${op}?${q}`, { signal: AbortSignal.timeout(40000) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* XML 오류 등 */ }
    const gw = json?.OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (gw) return { status: res.status, gateway: `${gw.returnReasonCode} ${gw.errMsg} (${gw.returnAuthMsg})`, items: [] };
    const header = json?.response?.header ?? json?.header;
    const raw = json?.response?.body?.items?.item ?? json?.response?.body?.items ?? [];
    const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
    return { status: res.status, header, total: json?.response?.body?.totalCount, items, text: json ? '' : hide(text.slice(0, 300)) };
  } catch (e) { return { status: 0, error: hide(e.message), items: [] }; }
}
const show = (title, r, keys) => {
  console.log(`\n■ ${title}: HTTP ${r.status} ${r.header ? `${r.header.resultCode} ${r.header.resultMsg}` : ''} 총 ${r.total ?? '-'}건`);
  if (r.error || r.text || r.gateway) console.log('  응답:', r.gateway || r.error || r.text);
  if (r.items[0]) console.log('  필드:', Object.keys(r.items[0]).join(', '));
  r.items.slice(0, 3).forEach((it) => console.log('  ·', (keys || Object.keys(it).slice(0, 6)).map((k) => `${k}=${String(it[k] ?? '').slice(0, 60)}`).join(' | ')));
};

const months = [];
const d = new Date(); d.setDate(1);
for (let k = 1; k <= 30; k++) { const t = new Date(d); t.setMonth(d.getMonth() - k); months.push(`${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}`); }

let base = null;
for (const ym of months) {
  const r = await call('TarRlteTarService1', 'areaBasedList1', { baseYm: ym, areaCd: '11', signguCd: '11110' });
  if (r.items.length) { base = ym; show(`연관 관광지 areaBasedList1 (서울 종로구, 기준 ${ym})`, r); break; }
  if (ym === months[0]) show(`연관 관광지 areaBasedList1 (기준 ${ym})`, r);
  if (r.gateway || r.error) { console.log('\n공공데이터포털 게이트웨이/네트워크 오류라 기준월 탐색을 멈춰요. 잠시 뒤 다시 실행해 주세요.'); break; }
}
console.log(`\n→ 데이터가 있는 최신 기준월: ${base ?? '못 찾음(최근 30개월)'}`);
if (base) {
  show('연관 관광지 areaBasedList1 (경기 과천 41290)', await call('TarRlteTarService1', 'areaBasedList1', { baseYm: base, areaCd: '41', signguCd: '41290', numOfRows: '50' }), ['tAtsNm', 'rlteTatsNm', 'rlteRank', 'rlteCtgryLclsNm', 'rlteCtgryMclsNm', 'rlteSignguNm']);
  show('연관 관광지 areaBasedList1 (경기 부천 41190)', await call('TarRlteTarService1', 'areaBasedList1', { baseYm: base, areaCd: '41', signguCd: '41190' }));
  show('연관 관광지 areaBasedList1 (경기 화성 41590)', await call('TarRlteTarService1', 'areaBasedList1', { baseYm: base, areaCd: '41', signguCd: '41590' }));
}

const kw = await call('KorService2', 'searchKeyword2', { keyword: '국립과천과학관', lDongRegnCd: '41' });
show('국문 관광정보 searchKeyword2 (국립과천과학관)', kw, ['contentid', 'contenttypeid', 'title', 'addr1', 'firstimage', 'modifiedtime', 'lDongRegnCd', 'lDongSignguCd']);
if (kw.items[0]) {
  const it = kw.items[0];
  const intro = await call('KorService2', 'detailIntro2', { contentId: it.contentid, contentTypeId: it.contenttypeid });
  show('국문 관광정보 detailIntro2', intro);
  if (intro.items[0]) Object.entries(intro.items[0]).filter(([k, v]) => /use|rest|info|reserv|open|park/i.test(k) && v).forEach(([k, v]) => console.log(`    ${k} = ${String(v).slice(0, 80)}`));
}
show('국문 관광정보 areaBasedList2 (제주 문화시설)', await call('KorService2', 'areaBasedList2', { lDongRegnCd: '50', contentTypeId: '14', arrange: 'Q' }), ['contentid', 'title', 'addr1', 'modifiedtime']);
show('국문 관광정보 areaBasedList2 (areaCode=39 옛 방식 확인)', await call('KorService2', 'areaBasedList2', { areaCode: '39', contentTypeId: '14' }), ['title', 'addr1']);
