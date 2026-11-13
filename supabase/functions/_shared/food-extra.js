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
  stat.buzz = await naverBuzz(body, env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET, stat);
  return stat;
}

// 인기 나들이 보강: 사설 체험·놀이 시설(키즈카페·실내동물원·체험농장·승마 등)은 공공데이터에 거의 없어서
// 네이버 지역 검색 '시군구 + 검색어'를 리뷰 많은 순으로 5곳씩 받아 인기 장소에 더해요. (네이버 키가 있을 때만)
const SPOT_WORDS = [['키즈카페', '체험·놀이', '실내'], ['실내놀이터', '체험·놀이', '실내'], ['체험농장', '자연·공원', '야외'], ['승마체험', '체험·놀이', '야외'], ['실내동물원', '체험·놀이', '실내']];
// 요즘 뜨는 곳: 팝업·전시·체험전처럼 공공데이터에 없는 '요즘' 장소. 큰 시군구(장소가 많은 순 30곳)만 찾아요.
const TREND_WORDS = [['팝업스토어', '체험·놀이', '실내'], ['아이랑 전시', '박물관', '실내'], ['어린이 체험전', '체험·놀이', '실내'], ['아이랑 가볼만한곳', '체험·놀이', '']];
const NOT_SPOT = /술집|주점|호프|노래|PC방|당구|스크린|골프|헬스|필라테스|요가|학원|병원|의원|부동산|모텔|호텔/;
export async function naverSpots(body, id, secret, stat) {
  if (!id || !secret) return 0;
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
      if (!name || NOT_SPOT.test(name + ' ' + cat) || /음식점|카페,디저트/.test(cat) && word !== '키즈카페') return;
      const addr = strip(it.roadAddress || it.address);
      // 검색한 시군구 밖(옆 동네) 결과는 빼요.
      if (c.label && !addr.includes(c.label)) return;
      const k = norm(name);
      const label = `네이버 ‘${c.label} ${word}’ 리뷰 많은 순 ${i + 1}위`;
      const had = (body.places || []).find((p) => norm(p.name) === k);
      // 이미 있는 곳이 요즘 검색에도 나오면 '요즘 뜨는'으로 표시만 해요.
      if (had) { if (trend && !had.trend) { had.trend = label; if (had.popularity) had.popularity.score += 15; } return; }
      if (out.has(k)) { if (trend && !out.get(k).trend) out.get(k).trend = label; return; }
      const x = Number(it.mapx), y = Number(it.mapy);
      out.set(k, {
        id: 'nspot-' + k, name, category, env, url: '', region: c.region, addr, tel: strip(it.telephone),
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

// 블로그 언급: '시군구 아이랑 가볼만한곳'의 최근 블로그 글 100개에 장소 이름이 몇 번 나오는지 세요.
// 많이 나온 곳일수록 요즘 사람들이 다녀와서 글을 쓰는 곳이라, 추천순에서 위로 올리고 '📝 블로그'로 표시해요.
const NAVER_HUB = 'https://naverapihub.apigw.ntruss.com/search/v1';
export async function naverBuzz(body, id, secret, stat) {
  if (!id || !secret) return 0;
  const places = (body.places || []).filter((p) => p.name && norm(p.name).length >= 3 && !(p.popularity && p.popularity.kind === 'festival'));
  const cities = citiesOf(body).slice(0, 25);
  let marked = 0;
  await pool(cities, 3, async (c) => {
    if (stat.naverErr) return;
    const q = new URLSearchParams({ query: `${c.label} 아이랑 가볼만한곳`, display: '100', start: '1', sort: 'date' });
    const res = await fetch(`${NAVER_HUB}/blog?${q}`, { headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret }, signal: AbortSignal.timeout(T) });
    if (!res.ok) { stat.blogErr = `HTTP ${res.status}`; return; }
    stat.naverCalls++;
    const posts = ((await res.json()).items || []).map((it) => norm(`${it.title} ${it.description}`));
    for (const p of places) {
      if (!String(p.region || '').includes(c.region.split(' ')[1])) continue;
      const k = norm(p.name);
      const n = posts.filter((t) => t.includes(k)).length;
      if (n < 2 || (p.buzz && p.buzz.n >= n)) continue;
      if (!p.buzz) marked++;
      p.buzz = { n, label: `최근 블로그 글 ${posts.length}개 중 ${n}개에 나와요`, query: `${c.label} 아이랑 가볼만한곳` };
      if (p.popularity) p.popularity.score += Math.min(n * 4, 30);
    }
  });
  return marked;
}
