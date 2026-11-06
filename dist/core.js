// 주말에 어디가지? — 화면과 무관한 순수 로직 (브라우저와 Node 테스트에서 함께 사용)
(function (root) {
  'use strict';

  const STORAGE_KEY = 'weekend-places-v2';
  const LEGACY_KEY = 'weekend-places-v1'; // 첫 버전 HTML이 쓰던 키 — 읽기만 하고 지우지 않아요.
  const SETTINGS_KEY = 'weekend-settings-v1';
  const LIVE_CACHE_KEY = 'weekend-live-cache-v1';

  // 나들이 카테고리(기본 추천 대상) — 키 이름은 v1 데이터와 호환되도록 그대로 둡니다.
  const TYPES = {
    '캠핑장': { icon: '⛺', bg: '#e5ebc8', env: '야외', outing: true },
    '박물관': { icon: '🏛️', bg: '#fae5c2', env: '실내', outing: true, label: '박물관·미술관' },
    '과학관': { icon: '🔭', bg: '#dfe8fb', env: '실내', outing: true, label: '어린이과학관·과학관' },
    '체험·놀이': { icon: '🎨', bg: '#f9dfe3', env: '실내', outing: true },
    '자연·공원': { icon: '🌳', bg: '#d7ebe0', env: '야외', outing: true },
    // 아이 나들이와 목적이 다를 수 있는 곳 — 보관은 하되 기본 추천에서는 빠져요.
    '맛집·카페': { icon: '🍽️', bg: '#f3e3d3', env: '', outing: false },
    '숙소·펜션': { icon: '🏡', bg: '#e8e2f3', env: '', outing: false },
    '골프·레저': { icon: '⛳', bg: '#dceee0', env: '야외', outing: false },
    '기타': { icon: '📍', bg: '#eee7dd', env: '', outing: false },
  };
  const OUTING = Object.keys(TYPES).filter((k) => TYPES[k].outing);
  const label = (c) => (TYPES[c] && TYPES[c].label) || c;

  const RULES = [
    ['골프·레저', /골프|컨트리\s?클럽|\bcc\b|스크린골프|golf|country club/i],
    ['캠핑장', /캠핑|야영|글램핑|오토캠|카라반|camp/i],
    ['과학관', /과학관|과학원|천문|사이언스|플라네타리움|science|planetarium/i],
    ['박물관', /박물관|미술관|기념관|역사관|전시관|뮤지엄|museum|gallery|갤러리/i],
    ['숙소·펜션', /펜션|호텔|리조트|모텔|민박|게스트하우스|풀빌라|스테이|hotel|resort|pension|hostel/i],
    ['자연·공원', /공원|수목원|식물원|동물원|휴양림|숲|생태|습지|해변|해수욕장|계곡|농장|목장|park|zoo|arboretum|forest|beach/i],
    ['체험·놀이', /키즈|어린이|체험|놀이|상상나라|아쿠아리움|수족관|테마파크|랜드|월드|트램폴린|방방|kids|aquarium|playground/i],
    ['맛집·카페', /식당|맛집|카페|커피|베이커리|빵|국밥|냉면|갈비|고기|치킨|피자|분식|횟집|레스토랑|면옥|막국수|떡볶이|브런치|restaurant|cafe|coffee|bakery|bistro/i],
  ];
  function infer(...texts) {
    const s = texts.filter(Boolean).join(' ');
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
  const PROVINCES = [
    [/^(서울|seoul)/i, '서울'], [/^(부산|busan)/i, '부산'], [/^(대구|daegu)/i, '대구'], [/^(인천|incheon)/i, '인천'],
    [/^(광주광역시|광주$|gwangju)/i, '광주'], [/^(대전|daejeon)/i, '대전'], [/^(울산|ulsan)/i, '울산'], [/^(세종|sejong)/i, '세종'],
    [/^(경기|gyeonggi)/i, '경기'], [/^(강원|gangwon)/i, '강원'], [/^(충청북도|충북|chungcheongbuk)/i, '충북'],
    [/^(충청남도|충남|chungcheongnam)/i, '충남'], [/^(전라북도|전북|jeollabuk|jeonbuk)/i, '전북'],
    [/^(전라남도|전남|jeollanam)/i, '전남'], [/^(경상북도|경북|gyeongsangbuk)/i, '경북'],
    [/^(경상남도|경남|gyeongsangnam)/i, '경남'], [/^(제주|jeju)/i, '제주'],
  ];
  // "대한민국 경기도 과천시 상하벌로 110" → "경기 과천"
  function regionFromAddress(addr) {
    if (!addr) return '';
    const words = String(addr).replace(/대한민국|south korea|republic of korea|,/gi, ' ').trim().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const hit = PROVINCES.find(([re]) => re.test(words[i]));
      if (!hit) continue;
      const next = words[i + 1] || '';
      const city = /^[가-힣]+(시|군|구)$/.test(next) ? next.replace(/시$/, '') : '';
      return [hit[1], city].filter(Boolean).join(' ');
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
      source: p.source || 'manual',
      addedAt: p.addedAt || new Date().toISOString(),
    };
  }

  // 저장 형식 { version: 2, places: [...] }. v2가 없으면 v1 배열을 읽어 옮겨 옵니다.
  function loadPlaces(storage) {
    const read = (k) => { try { return storage.getItem(k); } catch { return null; } };
    try {
      const v2 = JSON.parse(read(STORAGE_KEY) || 'null');
      if (v2 && Array.isArray(v2.places)) return { places: v2.places.map(makePlace), migrated: false };
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
    const report = { added: [], duplicates: [], errors: [], warnings: [] };
    for (const c of candidates) {
      if (c.error) { report.errors.push(c); continue; }
      if (c.warning) report.warnings.push({ name: c.name, warning: c.warning });
      const place = makePlace(c);
      if (!place.name) { report.errors.push({ line: c.line, error: '장소 이름이 없어요' }); continue; }
      const dup = next.find((s) => isDup(s, place));
      if (dup) { report.duplicates.push(place.name); continue; }
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
      if (!name) { out.push({ error: '이름을 찾지 못했어요: ' + url + ' — 위의 입력란에 이름과 함께 추가해 주세요' }); return; }
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

  function filterPlaces(list, f) {
    const q = String(f.q || '').trim().toLowerCase();
    return list.filter((p) => {
      if (f.category && p.category !== f.category) return false;
      if (!f.category && !f.includeOther && !(TYPES[p.category] || {}).outing) return false;
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
    STORAGE_KEY, LEGACY_KEY, SETTINGS_KEY, LIVE_CACHE_KEY, TYPES, OUTING, REGIONS, SEED,
    label, infer, regionFromAddress, inRegion, validUrl, canonicalUrl, mapSource, normName, isDup,
    makePlace, loadPlaces, savePlaces, mergeImport, parseCsv, fromCsv, fromGeoJson, fromShareText,
    filterPlaces, discoverPool, pickOne,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WeekendCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
