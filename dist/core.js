// 주말에 어디가지? — 화면과 무관한 순수 로직 (브라우저와 Node 테스트에서 함께 사용)
(function (root) {
  'use strict';

  const STORAGE_KEY = 'weekend-places-v2';
  const LEGACY_KEY = 'weekend-places-v1'; // 첫 버전 HTML이 쓰던 키 — 읽기만 하고 지우지 않아요.
  const SETTINGS_KEY = 'weekend-settings-v1';
  const LIVE_CACHE_KEY = 'weekend-live-cache-v1';

  // 세부 분류 — 키 이름은 v1 데이터와 호환되도록 그대로 둡니다('맛집·카페' 등).
  const TYPES = {
    '박물관': { icon: '🏛️', bg: '#fae5c2', env: '실내', group: 'kids', label: '박물관·미술관' },
    '과학관': { icon: '🔭', bg: '#dfe8fb', env: '실내', group: 'kids', label: '어린이과학관·과학관' },
    '체험·놀이': { icon: '🎨', bg: '#f9dfe3', env: '실내', group: 'kids' },
    '자연·공원': { icon: '🌳', bg: '#d7ebe0', env: '야외', group: 'kids' },
    '캠핑장': { icon: '⛺', bg: '#e5ebc8', env: '야외', group: 'camp' },
    '여행지': { icon: '🧳', bg: '#dcebf2', env: '야외', group: 'kids', label: '나들이·명소' },
    '축제·행사': { icon: '🎪', bg: '#fbe2cf', env: '야외', group: 'kids' },
    '맛집·카페': { icon: '🍽️', bg: '#f3e3d3', env: '실내', group: 'food', label: '음식점·카페' },
    '숙소·펜션': { icon: '🏡', bg: '#e8e2f3', env: '', group: 'stay', label: '숙소·펜션' },
    '관광·쇼핑': { icon: '🛍️', bg: '#efe6f5', env: '', group: 'etc', label: '시장·거리·쇼핑' },
    '골프·레저': { icon: '⛳', bg: '#dceee0', env: '야외', group: 'etc' },
    '기타': { icon: '📍', bg: '#eee7dd', env: '', group: 'etc' },
  };
  // 큰 분류. outing=true인 묶음만 '한 곳 골라줘'의 기본 후보가 돼요.
  const GROUPS = [
    { id: 'kids', label: '아이랑 가볼만한 곳', short: '아이랑', icon: '🧒', outing: true },
    { id: 'camp', label: '캠핑장', short: '캠핑장', icon: '⛺', outing: true },
    { id: 'food', label: '음식점·카페', short: '음식점', icon: '🍽️', outing: false },
    { id: 'stay', label: '숙소', short: '숙소', icon: '🏡', outing: false },
    { id: 'etc', label: '기타', short: '기타', icon: '📍', outing: false },
  ];
  const groupOf = (c) => (TYPES[c] || TYPES['기타']).group;
  const groupInfo = (id) => GROUPS.find((g) => g.id === id) || GROUPS[GROUPS.length - 1];
  const OUTING = Object.keys(TYPES).filter((k) => groupInfo(TYPES[k].group).outing);
  const label = (c) => (TYPES[c] && TYPES[c].label) || c;

  const RULES = [
    ['골프·레저', /골프|컨트리\s?클럽|\bcc\b|스크린골프|볼링|당구|golf|country club/i],
    ['캠핑장', /캠핑|야영|글램핑|오토캠|카라반|캠프(?=\s|$)|camp/i],
    ['과학관', /과학관|과학원|천문|사이언스|플라네타리움|science|planetarium/i],
    ['박물관', /박물관|미술관|기념관|역사관|전시관|뮤지엄|아트파크|아트센터|museum|gallery|갤러리/i],
    ['숙소·펜션', /펜션|호텔|리조트|모텔|민박|게스트하우스|풀빌라|스테이|숙박|hotel|resort|pension|hostel/i],
    ['축제·행사', /축제|페스티벌|박람회|festival/i],
    ['관광·쇼핑', /몰$|아울렛|백화점|면세점|쇼핑센터/], // '롯데월드몰'처럼 놀이 단어가 섞인 쇼핑몰을 먼저 걸러요
    ['자연·공원', /공원|수목원|식물원|동물원|휴양림|숲|생태|습지|계곡|농장|목장|park|zoo|arboretum|forest/i],
    ['체험·놀이', /키즈|어린이|체험|놀이|상상나라|아쿠아|수족관|워터파크|마법학교|치즈학교|테마파크|랜드|월드|트램폴린|방방|kids|aquarium|playground/i],
    ['맛집·카페', /음식점|식당|맛집|카페|커피|디저트|베이커리|빵|국밥|냉면|갈비|고기|치킨|피자|분식|횟집|레스토랑|면옥|막국수|떡볶이|브런치|한식|중식|일식|양식|restaurant|cafe|coffee|bakery|bistro/i],
    // 아이 나들이와 거리가 먼 관광지는 '기타'의 시장·거리·쇼핑으로 (워터파크·찜질방 같은 체험은 위에서 먼저 걸러져요)
    ['관광·쇼핑', /시장|거리$|쇼핑|아울렛|백화점|면세|몰$|온천|사찰|성당|교회|와이너리|양조|포차|카지노/],
    ['여행지', /관광|명소|여행|궁$|궁궐|성곽|한옥마을|전망대|타워|해변|해수욕장|섬$|폭포|케이블카|스카이워크|둘레길|호수|산성|정원|마을$|beach|island|tower|palace/i],
    ['체험·놀이', /여가/], // 네이버 업종 '여가'(키즈카페·놀이시설 등) — 이름으로 못 정할 때만
  ];
  // 사용자가 설정에서 추가한 분류: 큰 분류 하나와 같은 이름의 세부 분류 하나.
  // words(이름에 들어간 단어)가 있으면 기본 규칙보다 먼저 그 분류로 넣어요. 저장된 장소를 읽기 전에 등록해야 해요.
  const CUSTOM = [];
  function setCustom(list) {
    for (const c of CUSTOM) {
      delete TYPES[c.label];
      const i = GROUPS.findIndex((g) => g.id === c.id);
      if (i >= 0) GROUPS.splice(i, 1);
    }
    CUSTOM.length = 0;
    for (const c of Array.isArray(list) ? list : []) {
      const name = String((c && c.label) || '').trim();
      if (!c || !c.id || !name || TYPES[name] || GROUPS.some((g) => g.id === c.id)) continue;
      const icon = c.icon || '📌';
      TYPES[name] = { icon, bg: '#e6ecf6', env: '', group: c.id };
      GROUPS.splice(GROUPS.length - 1, 0, { id: c.id, label: name, short: name, icon, outing: false, custom: true }); // '기타'는 맨 뒤에 그대로
      CUSTOM.push({ id: c.id, label: name, words: (c.words || []).map((w) => String(w).trim()).filter(Boolean) });
    }
  }
  function infer(...texts) {
    const s = texts.filter(Boolean).join(' ');
    for (const c of CUSTOM) if (c.words.some((w) => s.includes(w))) return c.label;
    for (const [cat, re] of RULES) if (re.test(s)) return cat;
    return '기타';
  }

  const REGIONS = [
    { id: 'sg', label: '서울·경기', match: ['서울', '경기'] },
    { id: 'seoul', label: '서울', match: ['서울'] },
    { id: 'gyeonggi', label: '경기', match: ['경기'] },
    { id: 'incheon', label: '인천', match: ['인천'] },
    { id: 'gangwon', label: '강원', match: ['강원'] },
    { id: 'chung', label: '대전·세종·충청', match: ['대전', '세종', '충북', '충남'] },
    { id: 'jeolla', label: '광주·전라', match: ['광주', '전북', '전남'] },
    { id: 'gyeong', label: '부산·대구·울산·경상', match: ['부산', '대구', '울산', '경북', '경남'] },
    { id: 'jeju', label: '제주', match: ['제주'] },
    { id: 'all', label: '전국', match: null },
  ];
  // 광역 이름(정식·줄임·영문) → 짧은 이름. "서울숲"처럼 이름이 붙은 단어는 지역으로 보지 않아요.
  const PROV_WORDS = {
    '서울': ['서울', 'seoul'], '부산': ['부산', 'busan'], '대구': ['대구', 'daegu'], '인천': ['인천', 'incheon'],
    '광주': ['광주', 'gwangju'], '대전': ['대전', 'daejeon'], '울산': ['울산', 'ulsan'], '세종': ['세종', 'sejong'],
    '경기': ['경기', 'gyeonggi'], '강원': ['강원', 'gangwon'], '충북': ['충북', '충청북', 'chungcheongbuk'],
    '충남': ['충남', '충청남', 'chungcheongnam'], '전북': ['전북', '전라북', 'jeollabuk', 'jeonbuk'],
    '전남': ['전남', '전라남', 'jeollanam'], '경북': ['경북', '경상북', 'gyeongsangbuk'],
    '경남': ['경남', '경상남', 'gyeongsangnam'], '제주': ['제주', 'jeju'],
  };
  function provinceOf(word) {
    const w = String(word).toLowerCase().replace(/[,.]$/, '').replace(/(특별자치시|특별자치도|특별시|광역시|자치도|도|시|-do|-si)$/, '');
    return Object.keys(PROV_WORDS).find((k) => PROV_WORDS[k].includes(w)) || '';
  }
  // "대한민국 경기도 과천시 상하벌로 110" → "경기 과천"
  function regionFromAddress(addr) {
    if (!addr) return '';
    const words = String(addr).replace(/대한민국|south korea|republic of korea|,/gi, ' ').trim().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const prov = provinceOf(words[i]);
      if (!prov) continue;
      const next = words[i + 1] || '';
      const city = /^[가-힣]+(시|군|구)$/.test(next) ? next.replace(/시$/, '') : '';
      return [prov, city].filter(Boolean).join(' ');
    }
    return '';
  }
  function regionToken(place) {
    return String((place && place.region) || '').trim().split(/\s+/)[0] || '';
  }
  // true / false, 지역을 모르면 null
  function inRegion(place, regionId) {
    const r = REGIONS.find((x) => x.id === regionId) || REGIONS[0];
    if (!r.match) return true;
    const tok = regionToken(place);
    if (!tok) return null;
    return r.match.includes(tok);
  }

  function validUrl(s) {
    try {
      const u = new URL(String(s || '').trim());
      return ['https:', 'http:'].includes(u.protocol) ? u.href : '';
    } catch { return ''; }
  }
  function canonicalUrl(s) {
    const v = validUrl(s);
    if (!v) return '';
    const u = new URL(v);
    u.hash = '';
    [...u.searchParams.keys()].filter((k) => /^utm_|^entry$|^g_ep$|^c$/.test(k)).forEach((k) => u.searchParams.delete(k));
    return (u.host.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase();
  }
  function mapSource(url) {
    const v = validUrl(url);
    if (!v) return '';
    const h = new URL(v).host;
    if (/naver\.me|map\.naver\.com|naver\.com/.test(h)) return '네이버지도';
    if (/goo\.gl|google\./.test(h)) return '구글지도';
    return '지도';
  }
  const normName = (s) => String(s || '').toLowerCase().replace(/[\s()[\]{}·.,_\-'"`~!]/g, '');

  function isDup(a, b) {
    const ua = canonicalUrl(a.url), ub = canonicalUrl(b.url);
    if (ua && ub && ua === ub) return true;
    return normName(a.name) === normName(b.name) && (!ua || !ub || ua === ub);
  }

  let seq = 0;
  function newId() {
    const c = root.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return Date.now().toString(36) + '-' + (++seq) + '-' + Math.random().toString(36).slice(2, 8);
  }
  const coord = (v, min, max) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= min && n <= max ? n : null; };
  function makePlace(p) {
    const name = String(p.name || '').trim().slice(0, 150);
    const category = TYPES[p.category] ? p.category : infer(name, p.note, p.tags);
    return {
      id: p.id || newId(),
      name,
      url: validUrl(p.url),
      category,
      env: ['실내', '야외'].includes(p.env) ? p.env : TYPES[category].env,
      region: String(p.region || '').trim(),
      note: String(p.note || '').trim().slice(0, 500),
      list: p.list || '',
      lat: coord(p.lat, 33, 39), lng: coord(p.lng, 124, 132), // 한국 범위만
      manual: !!p.manual, // 사용자가 분류를 직접 바꾼 곳은 자동 재분류하지 않아요
      source: p.source || 'manual',
      addedAt: p.addedAt || new Date().toISOString(),
    };
  }

  // 저장 형식 { version: 2, places: [...] }. v2가 없으면 v1 배열을 읽어 옮겨 옵니다.
  function loadPlaces(storage) {
    const read = (k) => { try { return storage.getItem(k); } catch { return null; } };
    try {
      const v2 = JSON.parse(read(STORAGE_KEY) || 'null');
      if (v2 && Array.isArray(v2.places)) {
        const places = v2.places.map(makePlace);
        let changed = false;
        // 분류 체계가 바뀌어 '여행지' 중 시장·거리 등은 '기타'로 옮겨요(직접 고른 분류는 그대로).
        places.forEach((p) => {
          if (p.manual || p.category !== '여행지') return;
          const c = infer(p.name, p.note);
          if (c === '관광·쇼핑') { p.category = c; p.env = TYPES[c].env; changed = true; }
        });
        return { places, migrated: changed };
      }
    } catch { /* 손상된 v2는 무시하고 v1을 시도 */ }
    try {
      const v1 = JSON.parse(read(LEGACY_KEY) || '[]');
      if (Array.isArray(v1) && v1.length) {
        const places = v1.filter((p) => p && p.name).map((p) => makePlace({ ...p, source: p.source || 'v1' }));
        return { places, migrated: true };
      }
    } catch { /* 읽을 수 없는 v1 */ }
    return { places: [], migrated: false };
  }
  function savePlaces(storage, places) {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, savedAt: new Date().toISOString(), places }));
  }

  // 가져오기 후보(장소 또는 {error})를 기존 목록과 합칩니다.
  function mergeImport(saved, candidates) {
    const next = [...saved];
    const report = { added: [], duplicates: [], errors: [], warnings: [], located: [] };
    for (const c of candidates) {
      if (c.error) { report.errors.push(c); continue; }
      if (c.warning) report.warnings.push({ name: c.name, warning: c.warning });
      const place = makePlace(c);
      if (!place.name) { report.errors.push({ line: c.line, error: '장소 이름이 없어요' }); continue; }
      const dup = next.find((s) => isDup(s, place));
      if (dup) {
        // 이미 있는 곳이면 비어 있는 위치·링크·지역만 채워요(지도 보기용).
        if (dup.lat == null && place.lat != null) {
          const i = next.indexOf(dup);
          next[i] = { ...dup, lat: place.lat, lng: place.lng, url: dup.url || place.url, region: dup.region || place.region };
          report.located.push(place.name);
        }
        report.duplicates.push(place.name);
        continue;
      }
      next.push(place);
      report.added.push(place.name);
    }
    return { next, report };
  }

  function parseCsv(text) {
    const rows = []; let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') { field += '"'; i++; }
        else if (quoted || !field) quoted = !quoted;
        else field += c;
      } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
        row.push(field); field = '';
        if (c !== ',') { rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
      } else field += c;
    }
    if (quoted) throw new Error('따옴표가 닫히지 않은 CSV예요.');
    if (row.length || field) rows.push([...row, field]);
    return rows;
  }

  // 구글 Takeout '저장됨' CSV (Title, Note, URL, Tags, Comment)
  function fromCsv(text, listName) {
    const rows = parseCsv(String(text).replace(/^﻿/, ''));
    const header = (rows.shift() || []).map((x) => x.trim().toLowerCase());
    const col = (...keys) => header.findIndex((x) => keys.includes(x));
    const n = col('title', 'name', '제목', '이름', '장소 이름');
    if (n < 0) throw new Error('장소 이름 열(Title)을 찾지 못했어요.');
    const u = col('url', 'link', '링크'), m = col('note', '메모'), t = col('tags', '태그'), cm = col('comment', '댓글');
    const a = col('address', '주소');
    const out = [];
    rows.forEach((r, i) => {
      if (r.every((x) => !String(x).trim())) return; // 빈 줄
      const line = i + 2;
      const name = (r[n] || '').trim();
      const rawUrl = u >= 0 ? (r[u] || '').trim() : '';
      if (!name) { out.push({ line, error: '장소 이름이 비어 있어요' + (rawUrl ? ' (지도에 핀만 꽂은 항목일 수 있어요)' : '') }); return; }
      const url = validUrl(rawUrl);
      out.push({
        name, url, line,
        note: [m >= 0 ? r[m] : '', cm >= 0 ? r[cm] : ''].map((x) => (x || '').trim()).filter(Boolean).join(' / '),
        tags: t >= 0 ? r[t] : '',
        region: a >= 0 ? regionFromAddress(r[a]) : '',
        list: listName || '', source: 'google-csv',
        warning: rawUrl && !url ? '링크 형식이 올바르지 않아 이름만 저장해요' : '',
      });
    });
    return out;
  }

  // 구글 Takeout '지도(내 장소)'의 Saved Places.json (GeoJSON, 옛/새 형식 모두)
  function fromGeoJson(text, listName) {
    const data = JSON.parse(String(text).replace(/^﻿/, ''));
    const features = Array.isArray(data) ? data : data.features;
    if (!Array.isArray(features)) throw new Error('GeoJSON features 목록이 없어요.');
    return features.map((f, i) => {
      const p = (f && f.properties) || {};
      const loc = p.Location || p.location || {};
      const name = (loc['Business Name'] || loc.name || p.Title || p.name || '').trim();
      const url = p['Google Maps URL'] || p.google_maps_url || p.url || '';
      if (!name) return { line: i + 1, error: '장소 이름이 비어 있어요' };
      return {
        name, url: validUrl(url), line: i + 1,
        region: regionFromAddress(loc.Address || loc.address || ''),
        lng: f.geometry && f.geometry.coordinates && f.geometry.coordinates[0],
        lat: f.geometry && f.geometry.coordinates && f.geometry.coordinates[1],
        note: p.Comment || p.comment || '',
        list: listName || '', source: 'google-json',
      };
    });
  }

  const URL_RE = /https?:\/\/[^\s<>"']+/g;
  const SHARE_LABEL = /^\[?\s*(네이버\s?지도|naver\s?map|google\s?maps?|구글\s?지도|카카오맵)\s*\]?$/i;
  function nameFromGoogleUrl(url) {
    const m = /\/maps\/place\/([^/]+)/.exec(url || '');
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); } catch { return ''; }
  }
  // 네이버지도·구글지도 앱의 '공유 → 복사' 문구를 여러 개 붙여 넣어도 장소별로 나눕니다.
  function fromShareText(text) {
    const out = [];
    let block = [];
    const flush = (url) => {
      const lines = block.map((l) => l.trim()).filter((l) => l && !SHARE_LABEL.test(l));
      block = [];
      const addrLine = lines.find((l) => regionFromAddress(l) && /\d|로|길|동|읍|면/.test(l) && l.split(/\s+/).length >= 3);
      let name = lines.find((l) => l !== addrLine) || '';
      name = name.replace(/^[[(]?(네이버\s?지도|naver\s?map)[\])]?\s*/i, '').trim();
      if (!name) name = nameFromGoogleUrl(url);
      if (!name && !url) return;
      if (!name) { out.push({ url, linkOnly: true, error: '이름을 찾지 못한 링크예요: ' + url }); return; }
      out.push({ name, url: validUrl(url), region: regionFromAddress(addrLine || lines.join(' ')), source: 'share-text' });
    };
    for (const raw of String(text || '').split(/\r?\n/)) {
      const urls = raw.match(URL_RE);
      if (!urls) { block.push(raw); continue; }
      const rest = raw.replace(URL_RE, '').trim();
      if (rest) block.push(rest);
      urls.forEach((u) => flush(u.replace(/[),.]+$/, '')));
    }
    if (block.some((l) => l.trim())) flush('');
    return out;
  }

  // 가져오기 미리보기: 저장 전 후보마다 new / dup / error 상태를 붙여요.
  function previewImport(saved, candidates) {
    const seen = [...saved];
    return candidates.map((c, i) => {
      if (c.error) return { key: 'e' + i, status: 'error', error: c.error, line: c.line, file: c.file };
      const place = makePlace({ ...c, region: c.region || regionFromAddress(c.address) });
      if (!place.name) return { key: 'e' + i, status: 'error', error: '장소 이름이 없어요', line: c.line };
      const dup = seen.some((s) => isDup(s, place));
      if (!dup) seen.push(place);
      return { key: 'p' + i, status: dup ? 'dup' : 'new', place, warning: c.warning || '' };
    });
  }

  // 백업 파일(JSON) 내보내기·불러오기
  function exportBackup(places) {
    return JSON.stringify({ app: 'weekend-outing', version: 2, exportedAt: new Date().toISOString(), places }, null, 1);
  }
  function parseBackup(text) {
    const data = JSON.parse(String(text).replace(/^﻿/, ''));
    const rows = Array.isArray(data) ? data : data && data.places;
    if (!Array.isArray(rows)) throw new Error('주말에 어디가지? 백업 파일이 아니에요.');
    return rows.filter((p) => p && p.name).map((p) => ({ ...p, source: p.source || 'backup' }));
  }

  function filterPlaces(list, f) {
    const q = String(f.q || '').trim().toLowerCase();
    return list.filter((p) => {
      if (f.category && p.category !== f.category) return false;
      if (f.group && groupOf(p.category) !== f.group) return false;
      if (!f.category && !f.group && f.outingOnly && !OUTING.includes(p.category)) return false;
      if (f.env && p.env !== f.env) return false;
      if (f.region) {
        const r = inRegion(p, f.region);
        if (r === false || (r === null && !f.allowUnknownRegion)) return false;
      }
      return !q || [p.name, p.region, label(p.category), p.note, p.list].join(' ').toLowerCase().includes(q);
    });
  }

  // '새로운 장소': 실시간 후보 + 기본 추천을 합치고 이미 저장한 곳은 뺍니다.
  function discoverPool(live, seed, saved) {
    const pool = [];
    for (const p of [...(live || []), ...seed]) {
      if (pool.some((x) => normName(x.name) === normName(p.name))) continue;
      if (saved.some((s) => isDup(s, p))) continue;
      pool.push(p);
    }
    return pool;
  }

  // 직선거리(km). 위치가 없으면 null
  function distanceKm(a, b) {
    if (!a || !b || a.lat == null || b.lat == null || a.lng == null || b.lng == null) return null;
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function formatKm(km) {
    if (km == null) return '';
    if (km < 1) return `${Math.max(100, Math.round(km * 10) * 100)}m`;
    return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
  }
  // 가까운 순 (위치 없는 곳은 뒤로)
  function byDistance(list, here) {
    return [...list].map((p) => [p, distanceKm(here, p)])
      .sort((x, y) => (x[1] == null) - (y[1] == null) || x[1] - y[1]).map((x) => x[0]);
  }

  function shuffle(list, rnd) {
    const r = rnd || Math.random, a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function pickOne(list, avoidId, rnd) {
    const r = rnd || Math.random;
    const pool = list.length > 1 ? list.filter((p) => p.id !== avoidId) : list;
    return pool.length ? pool[Math.floor(r() * pool.length)] : null;
  }

  const SEED = [
    ['국립과천과학관', '경기 과천', '과학관', '과학 전시를 둘러보고 아이가 좋아하는 주제를 찾아보세요.'],
    ['서울상상나라', '서울 광진구', '체험·놀이', '어린이대공원 안에서 놀이와 체험 전시를 즐겨보세요.'],
    ['서울대공원 캠핑장', '경기 과천', '캠핑장', '숲에서 시간을 보내고 싶은 주말에 어울려요.'],
    ['국립어린이과학관', '서울 종로구', '과학관', '어린이 눈높이의 과학 전시를 만나볼 수 있어요.'],
    ['국립중앙박물관 어린이박물관', '서울 용산구', '박물관', '유물과 역사를 아이와 함께 놀이처럼 만나보세요.'],
    ['서울숲', '서울 성동구', '자연·공원', '아이와 산책하거나 잔디밭에서 쉬어가기 좋아요.'],
    ['난지캠핑장', '서울 마포구', '캠핑장', '한강 근처에서 캠핑을 즐기고 싶은 날에 살펴보세요.'],
    ['경기도어린이박물관', '경기 용인', '박물관', '아이 중심의 체험 전시를 둘러볼 수 있어요.'],
  ].map(([name, region, category, note], i) => ({
    id: 'seed' + i, name, region, category, note, env: TYPES[category].env, url: '', origin: 'seed',
  }));

  const api = {
    STORAGE_KEY, LEGACY_KEY, SETTINGS_KEY, LIVE_CACHE_KEY, TYPES, GROUPS, OUTING, REGIONS, SEED,
    label, groupOf, groupInfo, infer, setCustom, regionFromAddress, inRegion, validUrl, canonicalUrl, mapSource, normName, isDup,
    makePlace, loadPlaces, savePlaces, mergeImport, previewImport, exportBackup, parseBackup,
    parseCsv, fromCsv, fromGeoJson, fromShareText, filterPlaces, discoverPool, pickOne, shuffle, regionToken, distanceKm, formatKm, byDistance,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WeekendCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
