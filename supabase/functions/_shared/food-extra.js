// 맛집 데이터 보강 (배포 빌드에서만 사용) — 키가 없으면 그 단계만 건너뛰어요.
//  1) 카카오 로컬: 위치가 없는 맛집의 좌표·주소 채우기             KAKAO_REST_KEY
//  2) 네이버 지역 검색: '시군구 맛집/카페'를 리뷰 많은 순으로 5곳씩    NAVER_CLIENT_ID / NAVER_CLIENT_SECRET
//  3) 행정안전부 모범음식점 정보: 🏅 모범음식점 표시                TOUR_API_KEY(공공데이터포털 같은 키, 이 API 활용신청 필요)
//  4) 소상공인시장진흥공단 백년가게 지정 현황(CSV 파일): 💯 백년가게 표시  data-src/hundred-year.csv
// 키는 로그·결과에 절대 남기지 않아요.

const T = 15000;
const norm = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s|\(.*?\)|본점$|㈜|주식회사/g, '').toLowerCase();
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const cityOf = (region) => String(region || '').split(' ')[1] || '';
// 상호가 같고(지점명은 달라도) 같은 시군구 주소일 때만 같은 가게로 봐요.
const brand = (name) => norm(String(name).split(' ')[0]);
const sameShop = (name, region, otherName, addr) => {
  const a = norm(name), b = norm(otherName);
  if (!a || !b) return false;
  const nameOk = a === b || a.startsWith(b) || b.startsWith(a) || brand(name) === brand(otherName);
  const city = cityOf(region).replace(/(시|군|구)$/, '');
  return nameOk && (!city || String(addr || '').includes(city));
};
async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const x = list[i++]; try { await fn(x); } catch { /* 하나 실패는 건너뜀 */ } }
  }));
}
const CHAIN = /맥도날드|스타벅스|버거킹|롯데리아|KFC|맘스터치|이디야|투썸|빽다방|메가커피|메가MGC|컴포즈|파리바게|뚜레쥬르|던킨|배스킨|서브웨이|커피빈|할리스|폴바셋|탐앤탐스|엔제리너스|파스쿠찌|공차|bhc|BBQ|교촌|도미노|피자헛|미스터피자|아웃백|빕스|애슐리|본죽|김밥천국|이삭토스트|노브랜드|홍콩반점|역전우동|한솥|본도시락|설빙|더벤티|매머드|휴게소/i;

// 1) 카카오 로컬 — 위치 채우기
// 네이버 지역 검색: 2026년부터 새 키는 네이버 클라우드 API HUB에서만 발급돼요(주소·인증 헤더가 바뀜).
// 키: NCP 콘솔 → NAVER API HUB → Application → 인증 정보의 Client ID / Client Secret
// 좌표: 예전 API는 경도·위도×1천만 정수, API HUB는 그냥 소수일 수 있어서 둘 다 받아요
const wgs = (v) => (!Number.isFinite(v) || v === 0 ? null : v > 1e6 ? v / 1e7 : v);
function naverLocal(q, id, secret) {
  q.set('format', 'json');
  return fetch(`https://naverapihub.apigw.ntruss.com/search/v1/local?${q}`, { headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret }, signal: AbortSignal.timeout(T) });
}

export async function kakaoFill(foods, key, stat) {
  if (!key) return;
  const todo = foods.filter((f) => f.lat == null);
  await pool(todo, 4, async (f) => {
    if (stat.kakaoErr) return;
    const q = new URLSearchParams({ query: [cityOf(f.region), f.name].filter(Boolean).join(' '), size: '5' });
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${q}`, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(T) });
    if (!res.ok) { stat.kakaoErr = `HTTP ${res.status}`; return; }
    const docs = (await res.json()).documents || [];
    const hit = docs.find((d) => /음식점|카페/.test(d.category_name || '') && sameShop(f.name, f.region, d.place_name, d.address_name));
    if (!hit) return;
    f.lat = Number(hit.y); f.lng = Number(hit.x);
    f.addr = hit.road_address_name || hit.address_name;
    if (hit.phone && !f.tel) f.tel = hit.phone;
    stat.kakao++;
  });
}

// 2) 네이버 지역 검색 — 리뷰 많은 순
export async function naverFoods(cities, id, secret, stat) {
  if (!id || !secret) return [];
  const out = new Map();
  const jobs = cities.flatMap((c) => [['맛집', c], ['카페', c]]);
  await pool(jobs, 3, async ([word, c]) => {
    if (stat.naverErr) return;
    const q = new URLSearchParams({ query: `${c.label} ${word}`, display: '5', start: '1', sort: 'comment' });
    const res = await naverLocal(q, id, secret);
    if (!res.ok) { stat.naverErr = `HTTP ${res.status}`; return; }
    const items = (await res.json()).items || [];
    items.forEach((it, i) => {
      const name = strip(it.title);
      const cat = String(it.category || '');
      if (!name || CHAIN.test(name) || /술집|주점|바$|호프|이자카야|포차/.test(cat)) return;
      const k = norm(name);
      const rank = i + 1;
      const cur = out.get(k);
      if (cur) { cur.best = Math.min(cur.best, rank); return; }
      const x = Number(it.mapx), y = Number(it.mapy);
      out.set(k, {
        name, best: rank, word, city: c.label, region: c.region,
        kind: /카페|디저트|베이커리|제과|찻집/.test(cat) || word === '카페' ? '카페/찻집' : /한식/.test(cat) ? '한식' : /양식|일식|중식|아시아|멕시|이탈|프랑/.test(cat) ? '외국식' : '음식점',
        cat: cat.split('>').pop(), addr: strip(it.roadAddress || it.address), tel: strip(it.telephone),
        lat: wgs(y), lng: wgs(x),
      });
    });
    stat.naverCalls++;
  });
  return [...out.values()];
}
// 네이버 결과를 맛집 목록에 합치기: 이미 있는 곳은 '네이버 리뷰 많은 순'을 두 번째 근거로, 없는 곳은 새로 추가
export function mergeNaver(foods, found, basis) {
  for (const n of found) {
    const label = `네이버 ‘${n.city} ${n.word}’ 리뷰 많은 순 ${n.best}위`;
    const f = foods.find((x) => sameShop(x.name, x.region, n.name, n.addr) || norm(x.name) === norm(n.name));
    if (f) {
      f.naver = label;
      if (f.lat == null && n.lat != null) { f.lat = n.lat; f.lng = n.lng; }
      if (!f.addr) f.addr = n.addr;
      if (f.popularity) f.popularity.score += 20; // 두 곳에서 모두 인기면 위로
      else f.popularity = { kind: 'naver', label, source: '네이버 지역 검색(리뷰 많은 순)', basis, score: 30 - n.best };
      continue;
    }
    foods.push({
      id: 'nfood-' + norm(n.name), name: n.name, region: n.region, kind: n.kind, url: '', addr: n.addr, tel: n.tel, lat: n.lat, lng: n.lng,
      note: `${n.cat ? n.cat + ' · ' : ''}네이버 지역 검색에서 리뷰가 많은 곳이에요.`,
      popularity: { kind: 'naver', label, source: '네이버 지역 검색(리뷰 많은 순)', basis, score: 30 - n.best },
    });
  }
}

// 3) 모범음식점 (행정안전부)
export async function modelBadges(foods, key, stat) {
  if (!key) return;
  await pool(foods, 4, async (f) => {
    if (stat.modelErr) return;
    const q = new URLSearchParams({ serviceKey: key, pageNo: '1', numOfRows: '10', returnType: 'json', 'cond[BSNSSP_NM::LIKE]': String(f.name).split(' ')[0] });
    const res = await fetch(`https://apis.data.go.kr/1741000/excellent_restaurant_info/info?${q}`, { signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    if (!res.ok) { stat.modelErr = /NOT_REGISTERED/.test(text) ? '활용신청 필요' : `HTTP ${res.status}`; return; }
    let json; try { json = JSON.parse(text); } catch { return; }
    const items = json?.response?.body?.items?.item ?? json?.body?.items?.item ?? json?.items ?? json?.data ?? [];
    const list = Array.isArray(items) ? items : [items];
    const hit = list.find((x) => x && sameShop(f.name, f.region, x.BSNSSP_NM ?? x.bsnsspNm, x.ROAD_NM_ADDR ?? x.roadNmAddr ?? x.LOTNO_ADDR ?? x.lotnoAddr));
    if (hit) { f.badges = [...new Set([...(f.badges || []), '모범음식점'])]; stat.model++; }
  });
}

// 4) 백년가게 (CSV: 연번, 업체명, 업체주소, 연락처)
export function parseHundred(csv) {
  const rows = String(csv || '').replace(/^﻿/, '').split(/\r?\n/).map((l) => l.split(',').map((x) => x.replace(/^"|"$/g, '').trim()));
  const head = rows.shift() || [];
  const iName = head.findIndex((h) => /업체명|상호/.test(h)), iAddr = head.findIndex((h) => /주소/.test(h));
  if (iName < 0) return [];
  return rows.filter((r) => r[iName]).map((r) => ({ name: r[iName], addr: r.slice(iAddr).join(' ') }));
}
export function hundredBadges(foods, shops, stat) {
  if (!shops.length) return;
  for (const f of foods) {
    if (shops.some((s) => sameShop(f.name, f.region, s.name, s.addr))) { f.badges = [...new Set([...(f.badges || []), '백년가게'])]; stat.hundred++; }
  }
}

// 지역 파일 하나의 맛집 보강
export async function enrichFoods(body, env, hundredShops) {
  const stat = { kakao: 0, naverCalls: 0, model: 0, hundred: 0 };
  const foods = body.foods || [];
  // 네이버 검색할 시군구: 맛집·장소 목록에 나온 '시도 시군구'
  const seen = new Map();
  for (const p of [...foods, ...(body.places || [])]) {
    const [prov, city] = String(p.region || '').split(' ');
    if (prov && city && !seen.has(prov + city)) seen.set(prov + city, { label: city.replace(/(시|군)$/, (m) => (city.length > 2 ? '' : m)), region: `${prov} ${city}` });
  }
  const found = await naverFoods([...seen.values()].slice(0, 70), env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET, stat);
  mergeNaver(foods, found, new Date().toISOString().slice(0, 10));
  await kakaoFill(foods, env.KAKAO_REST_KEY, stat);
  await modelBadges(foods, env.TOUR_API_KEY, stat);
  hundredBadges(foods, hundredShops, stat);
  body.foods = foods;
  stat.spots = await naverSpots(body, env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET, stat);
  stat.farms = await naverVerifyFarms(body, env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET, stat);
  stat.buzz = await naverBuzz(body, env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET, stat);
  return stat;
}

// 인기 나들이 보강: 사설 체험·놀이 시설(키즈카페·실내동물원·체험농장·승마 등)은 공공데이터에 거의 없어서
// 네이버 지역 검색 '시군구 + 검색어'를 리뷰 많은 순으로 5곳씩 받아 인기 장소에 더해요. (네이버 키가 있을 때만)
const SPOT_WORDS = [['키즈카페', '체험·놀이', '실내'], ['실내놀이터', '체험·놀이', '실내'], ['체험농장', '자연·공원', '야외'], ['승마체험', '체험·놀이', '야외'], ['실내동물원', '체험·놀이', '실내']];
// 요즘 뜨는 곳: 팝업·전시·체험전처럼 공공데이터에 없는 '요즘' 장소. 큰 시군구(장소가 많은 순 30곳)만 찾아요.
// '팝업스토어'(그냥)는 어른용: 술·브랜드·백화점 팝업은 '어른용'으로, 캐릭터·체험 팝업은 아이용으로 넣어요.
const TREND_WORDS = [['팝업스토어', '어른용', '실내'], ['아이랑 팝업스토어', '체험·놀이', '실내'], ['아이랑 전시', '박물관', '실내'], ['어린이 체험전', '체험·놀이', '실내'], ['아이랑 가볼만한곳', '체험·놀이', '']];
// 유치원·어린이집·학교 같은 교육시설도 나들이 장소가 아니라서 빼요. (농장은 업종 대신 블로그 글로 확인해요: naverVerifyFarms)
const NOT_SPOT = /술집|주점|호프|노래|PC방|당구|스크린|골프|헬스|필라테스|요가|학원|병원|의원|부동산|모텔|호텔|유치원|어린이집|초등학교|중학교|고등학교|교회|성당|주민센터|아파트/;
// 요즘 검색(팝업 등)에서 아이랑 갈 곳이 아닌 것: 술·담배·성인, 그냥 가게(기념품·커피·옷·화장품), 지난해 행사
const NOT_TREND = /술|음주|주류|맥주|와인|위스키|소주|하이볼|칵테일|바$|펍|담배|성인|19금|카지노|기념품|편의점|커피|디저트|베이커리|의류|패션|신발|가방|화장품|뷰티|코스메틱|향수|주얼리|안경|면세|아울렛|백화점$|마트$|대학교|사무소|오피스|코리아리미티드|리미티드|주식회사|㈜/i;
// 네이버 업종으로 거르기: 식당은 '나들이'에서 빼고(키즈카페 검색 제외), '요즘' 결과는 아이랑 갈 만한 업종만 남겨요.
const FOOD_CAT = /음식점|식당|카페,디저트|브런치|베이커리|디저트|한식|양식|중식|일식|분식|아시아음식|이탈리아음식|스파게티|파스타|육류|고기|곱창|감자탕|떡볶이|만두|샐러드|뷔페|치킨|피자|햄버거|패스트푸드|짬뽕|짜장|마라탕|국수|냉면|해물|생선|돈가스|술집/;
const KID_CAT = /키즈|놀이|체험|관람|동물원|동물카페|고양이카페|테마파크|테마공원|박물관|미술관|전시관|과학관|아쿠아리움|식물원|수목원|공원|농원|팜스테이|농장|캠핑|문화시설|복합문화공간|캐릭터 팝업|애니메이션 팝업|게임 팝업|도서 팝업|장난감|공방|슬라임|롤러|수영장|승마|스포츠,오락|레저|썰매|도서관/;
const catOf = (p) => String(p.note || '').split(' · ')[0];
const POPUP = /팝업|pop-?up/i;
// 업종이 그냥 '팝업스토어'여도 이름으로 아이용인 걸 알아봐요(캐릭터·키즈).
const KID_NAME = /키즈|어린이|아이랑|유아|짱구|뽀로로|타요|핑크퐁|아기상어|티니핑|포켓몬|산리오|헬로키티|시나모롤|쿠로미|원피스|도라에몽|코난|레고|토이|장난감|캐릭터|kids|lego|pokemon/i;
const pastYear = (s) => (String(s).match(/20\d\d/g) || []).some((y) => Number(y) < new Date().getFullYear());
export async function naverSpots(body, id, secret, stat) {
  if (!id || !secret) return 0;
  // 지난 빌드에서 이어 온 '요즘' 결과도 같은 기준으로 다시 걸러요(예전 '팝업스토어' 검색 결과, 술·가게·지난해 행사).
  // 지난 빌드에서 어른용으로 들어간 캐릭터·키즈 팝업은 체험·놀이로 옮겨요.
  for (const p of body.places || []) if (p.category === '어른용' && KID_NAME.test(p.name) && !NOT_TREND.test(p.name)) p.category = '체험·놀이';
  const adult = (p) => p.category === '어른용';
  const badTrend = (p) => p.trend && (adult(p) || KID_NAME.test(p.name) && !NOT_TREND.test(p.name) ? pastYear(p.name) : NOT_TREND.test(p.name) || pastYear(p.name) || /‘[^’]* 팝업스토어’/.test(p.trend) && !/아이랑 팝업스토어/.test(p.trend)
    || String(p.id).startsWith('nspot-') && !KID_CAT.test(catOf(p)) && !KID_NAME.test(p.name));
  const food = (p) => !adult(p) && String(p.id).startsWith('nspot-') && FOOD_CAT.test(catOf(p)) && !/키즈카페/.test(String(p.popularity && p.popularity.label));
  const notSpot = (p) => String(p.id).startsWith('nspot-') && !adult(p) && NOT_SPOT.test(p.name + ' ' + catOf(p));
  body.places = (body.places || []).filter((p) => !(String(p.id).startsWith('nspot-') && badTrend(p)) && !food(p) && !notSpot(p));
  for (const p of body.places) if (badTrend(p)) delete p.trend;
  const cities = citiesOf(body);
  const jobs = [...cities.slice(0, 70).flatMap((c) => SPOT_WORDS.map((w) => [w, c])), ...cities.slice(0, 30).flatMap((c) => TREND_WORDS.map((w) => [w, c, true]))];
  const out = new Map();
  await pool(jobs, 3, async ([[word, category, env], c, trend]) => {
    if (stat.naverErr) return;
    const q = new URLSearchParams({ query: `${c.label} ${word}`, display: '5', start: '1', sort: 'comment' });
    const res = await naverLocal(q, id, secret);
    if (!res.ok) { stat.naverErr = `HTTP ${res.status}`; return; }
    stat.naverCalls++;
    ((await res.json()).items || []).forEach((it, i) => {
      const name = strip(it.title); const cat = String(it.category || '');
      const addr = strip(it.roadAddress || it.address);
      // 검색한 시군구 밖(옆 동네) 결과는 빼요.
      if (!name || c.label && !addr.includes(c.label) || trend && pastYear(name)) return;
      const kidOk = !NOT_SPOT.test(name + ' ' + cat) && !(FOOD_CAT.test(cat) && word !== '키즈카페') && !(trend && (NOT_TREND.test(name + ' ' + cat) || !KID_CAT.test(cat)));
      // 그냥 '팝업스토어' 검색: 아이랑 갈 만하면 체험·놀이, 아니어도 팝업이면 어른용, 팝업도 아니면(기념품점 등) 빼요.
      const kidPopup = category === '어른용' && POPUP.test(name + ' ' + cat) && KID_NAME.test(name) && !NOT_TREND.test(name);
      const cate = category !== '어른용' ? category : kidOk || kidPopup ? '체험·놀이' : '어른용';
      if (cate === '어른용' ? !POPUP.test(name + ' ' + cat) : !(kidOk || kidPopup)) return;
      const k = norm(name);
      const label = `네이버 ‘${c.label} ${word}’ 리뷰 많은 순 ${i + 1}위`;
      const had = (body.places || []).find((p) => norm(p.name) === k);
      // 이미 있는 곳이 요즘 검색에도 나오면 '요즘 뜨는'으로 표시만 해요.
      if (had) { if (trend && !had.trend) { had.trend = label; if (had.popularity) had.popularity.score += 15; } return; }
      if (out.has(k)) { if (trend && !out.get(k).trend) out.get(k).trend = label; return; }
      const x = Number(it.mapx), y = Number(it.mapy);
      out.set(k, {
        id: 'nspot-' + k, name, category: cate, env, url: '', region: c.region, addr, tel: strip(it.telephone),
        lat: wgs(y), lng: wgs(x),
        note: `${cat.split('>').pop() || word} · 네이버 지역 검색에서 리뷰가 많은 곳이에요.`,
        ...(trend ? { trend: label } : {}),
        popularity: { kind: 'naver', label, source: '네이버 지역 검색(리뷰 많은 순)', basis: new Date().toISOString().slice(0, 10), score: (trend ? 34 : 26) - i * 3 },
      });
    });
  });
  body.places = [...(body.places || []), ...out.values()];
  return out.size;
}

// 장소·맛집 목록에 나온 '시도 시군구' — 장소가 많은 시군구부터
function citiesOf(body) {
  const seen = new Map();
  for (const p of [...(body.places || []), ...(body.foods || [])]) {
    const [prov, city] = String(p.region || '').split(' ');
    if (!prov || !city) continue;
    const k = prov + city;
    if (!seen.has(k)) seen.set(k, { label: city.replace(/(시|군)$/, (m) => (city.length > 2 ? '' : m)), region: `${prov} ${city}`, n: 0 });
    seen.get(k).n++;
  }
  return [...seen.values()].sort((a, b) => b.n - a.n);
}

const NAVER_HUB = 'https://naverapihub.apigw.ntruss.com/search/v1';
const shortName = (name) => norm(String(name).replace(/\s+[^\s]*[가-힣A-Za-z0-9]점$/, '').replace(/\[.*?\]/g, ''));
// 체험농장 검색 결과 확인: 동네에 체험농장이 적으면 리뷰 몇 개뿐인 곳도 '2위'로 들어와요(네이버는 리뷰 수를 안 줘요).
// '이름 + 시군구' 블로그 글(관련도 순 30개) 중 제목·요약에 그 이름이 나온 글이 3개 이상인 곳만 남겨요.
// 확인한 곳은 2주 동안 다시 묻지 않아요. 블로그 검색이 안 되면(키·한도 문제) 아무것도 빼지 않아요.
export async function naverVerifyFarms(body, id, secret, stat) {
  if (!id || !secret) return 0;
  const cities = citiesOf(body);
  const cityOf = (p) => cities.find((c) => c.region === String(p.region || '').split(' ').slice(0, 2).join(' '));
  const fresh = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const farms = (body.places || []).filter((p) => String(p.id).startsWith('nspot-') && /체험농장/.test(String(p.popularity && p.popularity.label)) && !(p.blogCheck && p.blogCheck.at >= fresh));
  const drop = new Set();
  await pool(farms, 4, async (p) => {
    if (stat.blogErr) return;
    const c = cityOf(p); const k = shortName(p.name);
    const q = new URLSearchParams({ query: c ? strip(p.name) + ' ' + c.label : strip(p.name), display: '30', start: '1', sort: 'sim' });
    const res = await fetch(NAVER_HUB + '/blog?' + q, { headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret }, signal: AbortSignal.timeout(T) });
    if (!res.ok) { stat.blogErr = 'HTTP ' + res.status; return; }
    stat.naverCalls++;
    const n = ((await res.json()).items || []).filter((it) => norm(it.title + ' ' + it.description).includes(k)).length;
    if (n < 3) drop.add(p); else p.blogCheck = { n, at: new Date().toISOString().slice(0, 10) };
  });
  if (!stat.blogErr) body.places = body.places.filter((p) => !drop.has(p));
  stat.farmsDropped = stat.blogErr ? 0 : drop.size;
  return farms.length;
}

// 블로그 언급: 인기 장소(점수 높은 순 120곳)마다 '장소 이름 + 시군구'로 최신 블로그 글 50개를 받아,
// 최근 30일 안에 쓴 글 중 제목·요약에 그 이름이 나온 글 수를 세요. 3개 이상이면 '📝 블로그'로 표시하고 추천순에서 올려요.
// (하루 호출 한도 25,000회 중 지역마다 120회 정도)
export async function naverBuzz(body, id, secret, stat) {
  if (!id || !secret) return 0;
  const cities = citiesOf(body);
  const cityOf = (p) => cities.find((c) => c.region === String(p.region || '').split(' ').slice(0, 2).join(' '));
  const places = (body.places || [])
    .filter((p) => shortName(p.name).length >= 3 && !(p.popularity && p.popularity.kind === 'festival') && cityOf(p))
    .sort((x, y) => ((y.popularity && y.popularity.score) || 0) - ((x.popularity && x.popularity.score) || 0))
    .slice(0, 120);
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  let marked = 0;
  await pool(places, 4, async (p) => {
    if (stat.naverErr || stat.blogErr) return;
    const c = cityOf(p); const k = shortName(p.name);
    const query = `${strip(p.name).replace(/\[.*?\]/g, '').trim()} ${c.label}`;
    const q = new URLSearchParams({ query, display: '50', start: '1', sort: 'date' });
    const res = await fetch(`${NAVER_HUB}/blog?${q}`, { headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret }, signal: AbortSignal.timeout(T) });
    if (!res.ok) { stat.blogErr = `HTTP ${res.status}`; return; }
    stat.naverCalls++;
    const n = ((await res.json()).items || []).filter((it) => String(it.postdate || '') >= since && norm(`${it.title} ${it.description}`).includes(k)).length;
    if (n < 3) return;
    marked++;
    p.buzz = { n, label: `최근 30일 블로그 글 ${n}${n >= 50 ? '개 이상' : '개'}`, query };
    if (p.popularity) p.popularity.score += Math.min(n, 30);
  });
  return marked;
}
