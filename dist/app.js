// 주말에 어디가지? — 화면 동작 (홈 / 즐겨찾기 / 설정)
(function () {
  'use strict';
  const C = window.WeekendCore;
  const CONFIG = window.WEEKEND_CONFIG || {};
  const API = String(CONFIG.apiBase ?? 'api').replace(/\/+$/, '');
  // 배포 사이트: 인기 장소는 매일 미리 만든 파일(data/), 리스트 읽기는 Supabase 함수
  const DATA = CONFIG.dataBase ? String(CONFIG.dataBase).replace(/\/+$/, '') : '';
  const IMPORT_LIST = CONFIG.importListUrl || `${API}/import-list`;
  const dataRegion = (r) => (['seoul', 'gyeonggi', 'all'].includes(r) ? 'sg' : r); // 서울·경기·전국은 한 파일을 지역으로 걸러 써요
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LIVE_TTL = 12 * 60 * 60 * 1000;

  // ---------- 상태 ----------
  // 설정에서 추가한 분류를 먼저 등록해야, 저장된 장소가 그 분류를 그대로 유지해요.
  try { C.setCustom((JSON.parse(localStorage.getItem(C.SETTINGS_KEY) || '{}') || {}).customGroups); } catch { /* 없음 */ }
  const loaded = C.loadPlaces(localStorage);
  let saved = loaded.places;
  if (loaded.migrated) persist(saved, true);

  const defaults = { region: 'sg', homeCat: '', favRecCat: '', env: '', favSrc: '', favCat: '', favRegion: '', favOrder: 'near', popSort: 'score', popSub: '', foodSrc: '', foodKind: '', foodKids: false, foodReg: '', foodSort: 'score', evWhen: 'weekend', evSub: '', evSort: 'date', mapApp: 'naver', pickFrom: 'all', homeCats: null, customGroups: [] };
  let ui = { ...defaults };
  try {
    const s = JSON.parse(localStorage.getItem(C.SETTINGS_KEY) || '{}');
    ui = { ...defaults, ...s };
    if (!Array.isArray(ui.customGroups)) ui.customGroups = [];
    // 예전 설정(큰 분류 homeGroups)은 그 묶음의 분류들로 옮겨요.
    if (!Array.isArray(ui.homeCats) && Array.isArray(s.homeGroups)) ui.homeCats = Object.keys(C.TYPES).filter((k) => s.homeGroups.includes(C.TYPES[k].group));
  } catch { /* 기본값 */ }
  try {
    if (!C.TYPES[ui.homeCat]) ui.homeCat = ''; // 홈 '요즘 인기'와 인기 탭의 분류
    if (!C.TYPES[ui.favRecCat]) ui.favRecCat = ''; // 홈 '즐겨찾기에서 추천'의 분류
    if (ui.favCat && !C.TYPES[ui.favCat]) ui.favCat = '';
    // 홈에 보일 분류: 처음엔 나들이 분류 + 음식점
    if (!Array.isArray(ui.homeCats)) ui.homeCats = [...C.OUTING, '맛집·카페'];
    ui.homeCats = ui.homeCats.filter((k) => C.TYPES[k]);
    delete ui.homeGroup; delete ui.homeGroups; delete ui.favGroup; // 예전 큰 분류 설정
    // 인기·맛집 화면은 열 때마다 인기순으로 시작해요(거리순은 그때그때 눌러서).
    ui.popSort = 'score'; ui.foodSort = 'score';
  } catch { /* 기본값 */ }
  let live = { status: 'loading', places: [], meta: null };
  let order = new Map(); // 홈 즐겨찾기 추천 섞기 순서
  let lastPickId = null;
  let preview = []; // 가져오기 미리보기 항목

  function persist(next, quiet) {
    try { C.savePlaces(localStorage, next); saved = next; markDirty(); return true; } catch {
      if (!quiet) alert('브라우저에 저장할 수 없어요. 저장 공간이나 사생활 보호 모드를 확인해 주세요.');
      return false;
    }
  }
  function saveUi() {
    try { localStorage.setItem(C.SETTINGS_KEY, JSON.stringify(ui)); } catch { /* 선택 */ }
    // 계정에 저장하는 설정(지역·지도 앱·홈 분류·추가한 분류)이 바뀌었을 때만 동기화
    const sig = uiSig(); if (lastUiSig !== undefined && sig !== lastUiSig) markDirty(); lastUiSig = sig;
  }
  // 확인 창: 휴대폰의 앱 안 브라우저 등은 기본 confirm 창을 막아 버려서, 앱 안의 창으로 물어봐요.
  function ask(msg, ok = '확인') {
    return new Promise((resolve) => {
      const dlg = $('askDlg');
      const done = (v) => { dlg.removeEventListener('close', onClose); $('askOk').onclick = $('askNo').onclick = null; if (dlg.open) dlg.close(); resolve(v); };
      const onClose = () => done(false);
      $('askMsg').textContent = msg; $('askOk').textContent = ok;
      $('askOk').onclick = () => done(true);
      $('askNo').onclick = () => done(false);
      dlg.addEventListener('close', onClose);
      dlg.showModal();
    });
  }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- 공통 조각 ----------
  const T = (p) => C.TYPES[p.category] || C.TYPES['기타'];
  // 장소 열기는 설정에서 고른 지도 앱 하나로. 저장된 링크가 그 지도의 것이면 그대로, 아니면 이름으로 검색해요.
  const MAP_APPS = { naver: '네이버지도', google: '구글지도' };
  function mapHref(p) {
    const label = MAP_APPS[ui.mapApp] || MAP_APPS.naver;
    const url = C.validUrl(p.url);
    if (url && C.mapSource(url) === label) return { href: url, label };
    const term = encodeURIComponent([p.name, p.region].filter(Boolean).join(' '));
    return { href: ui.mapApp === 'google' ? `https://www.google.com/maps/search/?api=1&query=${term}` : `https://map.naver.com/p/search/${term}`, label };
  }
  function mapButtons(p, cls = '') {
    const m = mapHref(p);
    return `<a class="link primary ${cls}" target="_blank" rel="noopener noreferrer" href="${esc(m.href)}">🗺 ${esc(m.label)}에서 열기</a>`;
  }
  const mapLink = (p) => { const m = mapHref(p); return `<a class="link maplink" target="_blank" rel="noopener noreferrer" href="${esc(m.href)}" aria-label="${esc(p.name)} ${esc(m.label)}에서 열기">🗺 ${esc(m.label.replace('지도', ''))}</a>`; };
  // 이번 주말 행사: 공식 사이트(관광공사 정보에 있을 때) 또는 네이버 검색으로 연결
  const isEvent = (p) => !!(p.popularity && p.popularity.kind === 'festival');
  const eventHref = (p) => (p.homepage ? { href: p.homepage, label: '행사 사이트' } : { href: `https://search.naver.com/search.naver?query=${encodeURIComponent(p.name)}`, label: '행사 정보' });
  const popLine = (p) => (isEvent(p) ? `<a class="pop evlink" target="_blank" rel="noopener noreferrer" href="${esc(eventHref(p).href)}">🎪 ${esc(p.evLabel || '이번 주말')} · ${eventHref(p).label} ›</a>`
    : p.popularity ? `<span class="pop">🔥 ${esc(p.popularity.label)}</span>` : '');
  // 정렬 두 가지를 나란히 보여주는 버튼 묶음
  const seg = (attr, cur, opts) => `<span class="seg">${opts.map(([v, t]) => `<button class="small ${cur === v ? 'active' : ''}" ${attr}="${v}">${t}</button>`).join('')}</span>`;
  function art(p, extra = '') {
    const t = T(p);
    const badge = p.origin === 'seed' ? '기본 추천' : p.popularity ? (p.popularity.kind === 'festival' ? p.evBadge || '이번 주말' : '인기') : '';
    return `<div class="art" style="background:${t.bg}">${t.icon}${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}` +
      (badge ? `<span class="badge">${esc(badge)}</span>` : '') + extra + '</div>';
  }
  // 거리는 장소별로 한 번만 계산해 두고, 위치가 1km 넘게 바뀔 때만 다시 계산해요.
  let distMemo = new Map();
  function distKm(p) {
    if (!here || p.lat == null) return null;
    const k = p.id + ':' + p.lat;
    if (!distMemo.has(k)) distMemo.set(k, C.distanceKm(here, p));
    return distMemo.get(k);
  }
  const distText = (p) => C.formatKm(distKm(p));
  const metaLine = (p, unknown = '') => [distText(p), p.kind || C.label(p.category), p.kind ? '' : p.env, p.region || unknown].filter(Boolean).map(esc).join(' · ');

  // ---------- 내 위치 (자동으로 거리 표시) ----------
  // 앱을 열 때 한 번 위치를 받아 이 기기에 기억해요(다음에 열면 기억한 위치로 바로 표시 후 조용히 갱신).
  // 브라우저 위치 기능은 https 주소(또는 PC의 localhost)에서만 동작해요.
  const HERE_KEY = 'weekend-here-v1';
  let here = null;
  let hereStatus = 'unknown';
  try { here = JSON.parse(localStorage.getItem(HERE_KEY) || 'null'); } catch { /* 없음 */ }
  function locate(then) {
    if (!navigator.geolocation || !window.isSecureContext) { hereStatus = 'insecure'; return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
      const moved = !here || C.distanceKm(here, next) > 1;
      hereStatus = 'ok';
      try { localStorage.setItem(HERE_KEY, JSON.stringify(next)); } catch { /* 선택 */ }
      if (moved) { here = next; distMemo = new Map(); render(); }
      if (then) then();
    }, (err) => {
      hereStatus = err.code === 1 ? 'denied' : 'failed';
      if (then) toast(err.code === 1 ? '위치 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 위치를 허용해 주세요.' : '위치를 확인하지 못했어요.');
      if (route() === 'settings') render();
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 });
  }
  const isSaved = (p) => saved.some((s) => s.id === p.id || C.isDup(s, p));
  // 즐겨찾기 출처: 지도 앱 리스트에서 가져온 곳 / 이 앱에서 ♡ 누른 곳 / 그 밖(직접·파일·공유)
  const SRC = { naver: '🟢 네이버', google: '🔵 구글', app: '♥ 이 앱', etc: '📄 기타' };
  function srcOf(p) {
    const s = String(p.source || '');
    if (s === 'popular' || s === 'seed') return 'app';
    if (/^naver/.test(s)) return 'naver';
    if (/^google/.test(s)) return 'google';
    const m = C.mapSource(p.url);
    return m === '네이버지도' ? 'naver' : m === '구글지도' ? 'google' : 'etc';
  }
  // 저장돼 있으면 ♥(누르면 빼기), 인기 장소면 ♡(누르면 저장)
  const heartBtn = (p, cls) => (isSaved(p) ? `<button class="${cls} saved" data-unsave="${esc(p.id)}" aria-label="${esc(p.name)} 즐겨찾기에서 빼기">♥</button>`
    : p.origin ? `<button class="${cls}" data-save="${esc(p.id)}" aria-label="${esc(p.name)} 저장">♡</button>` : '');
  // 제외 목록: 네이버·구글(또는 파일)에서 가져왔다가 뺀 곳을 장소 정보째 기억해요.
  // 리스트를 다시 가져오거나 [업데이트]해도 이 곳들은 건너뛰고, 설정 → 제외한 즐겨찾기에서 되돌릴 수 있어요.
  const EXCL_KEY = 'weekend-excluded-v1';
  const readExcluded = () => { try { const v = JSON.parse(localStorage.getItem(EXCL_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const writeExcluded = (v) => { try { localStorage.setItem(EXCL_KEY, JSON.stringify(v.slice(-3000))); markDirty(); return true; } catch { return false; } };
  const placeKeys = (p) => [C.canonicalUrl(p.url), 'n:' + C.normName(p.name)].filter(Boolean);
  const hits = (x, p) => { const ks = placeKeys(p); return (x.keys || []).some((k) => ks.includes(k)); };
  const isExcluded = (p) => readExcluded().some((x) => hits(x, p));
  // 즐겨찾기에서 빼기. 이 앱에서 ♡한 곳은 그냥 빼고, 가져온 곳은 제외 목록에 넣어요.
  function removePlaces(list) {
    if (!list.length || !persist(saved.filter((x) => !list.includes(x)))) return false;
    const at = new Date().toISOString();
    const add = list.filter((p) => srcOf(p) !== 'app').map((p) => ({ keys: placeKeys(p), at, place: { name: p.name, url: p.url, category: p.category, env: p.env, region: p.region, note: p.note, list: p.list, source: p.source, lat: p.lat, lng: p.lng } }));
    if (add.length) writeExcluded([...readExcluded().filter((x) => !add.some((a) => a.keys.some((k) => x.keys.includes(k)))), ...add]);
    return true;
  }
  async function unsave(id) {
    const p = findPlace(id);
    if (!p) return false;
    const mine = saved.filter((x) => x.id === id || C.isDup(x, p));
    if (!mine.length) return false;
    const from = srcOf(mine[0]);
    if (from !== 'app' && !await ask(`‘${mine[0].name}’을(를) 즐겨찾기에서 뺄까요?\n${SRC[from]}에서 가져온 곳이라 제외 목록에 넣어요. 리스트를 다시 [업데이트]해도 들어오지 않고, 설정 → 제외한 즐겨찾기에서 되돌릴 수 있어요.`, '빼기')) return false;
    if (!removePlaces(mine)) return false;
    toast(`‘${mine[0].name}’을(를) 즐겨찾기에서 뺐어요`);
    return true;
  }
  // 지금 보이는 목록(출처·분류·지역·검색) 전체 제외
  async function excludeShown() {
    const { rows } = favRows();
    if (!rows.length) return;
    const what = [ui.favSrc && SRC[ui.favSrc], ui.favCat && C.label(ui.favCat), ui.favRegion].filter(Boolean).join(' · ') || '전체';
    if (!await ask(`‘${what}’ ${rows.length}곳을 모두 즐겨찾기에서 뺄까요?\n가져온 곳은 제외 목록에 넣어서, 리스트를 다시 [업데이트]해도 들어오지 않아요. 설정 → 제외한 즐겨찾기에서 되돌릴 수 있어요.`, `${rows.length}곳 빼기`)) return;
    if (removePlaces(rows)) { ui.favCat = ''; ui.favRegion = ''; saveUi(); render(); toast(`${rows.length}곳을 뺐어요`); }
  }
  async function restoreExcluded(i) {
    const all = readExcluded();
    const list = i === 'all' ? all : [all[Number(i)]].filter(Boolean);
    if (!list.length) return;
    if (i === 'all' && !await ask(`제외한 ${list.length}곳을 모두 즐겨찾기로 되돌릴까요?`, '되돌리기')) return;
    writeExcluded(all.filter((x) => !list.includes(x)));
    const r = saveCandidates(list.map((x) => x.place));
    render();
    if (r) toast(list.length === 1 ? `‘${list[0].place.name}’을(를) 되돌렸어요` : `${r.added.length}곳을 되돌렸어요`);
  }

  function mini(p) {
    const heart = heartBtn(p, 'heart');
    return `<article class="mini" data-detail="${esc(p.id)}" tabindex="0" role="button">${art(p, heart)}<div class="body">` +
      `<span class="muted">${metaLine(p)}</span><h3>${esc(p.name)}</h3>` +
      popLine(p) + '</div></article>';
  }
  function detailHtml(p) {
    const pop = p.popularity ? `<div class="popbox">${isEvent(p) ? '🎪' : '🔥'} <b>${esc(p.popularity.label)}</b><div class="muted">${esc(p.popularity.source)} · 기준 ${esc(p.popularity.basis)}</div></div>` : '';
    const h = p.hours || {};
    const rows = [['기간', h.period], ['장소', h.addr], ['이용시간', h.usetime], ['쉬는 날', h.restdate], ['메뉴', h.menu], ['요금', h.usefee], ['놀이방', h.kids], ['유모차', h.babycarriage], ['주차', h.parking], ['예약', h.reservation], ['문의', h.infocenter]].filter(([, v]) => v);
    const hours = rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><p class="muted">출처: ${esc(h.source || '')}${h.updated ? ` · 정보 수정일 ${esc(h.updated)}` : ''}</p>` : '';
    const note = p.note || (p.origin === 'seed' ? '' : '');
    const savedHere = isSaved(p);
    const own = saved.find((s) => s.id === p.id);
    const actions = (own ? `<button data-edit="${esc(own.id)}">✏️ 분류·편집</button>` : '') +
      (savedHere ? `<button data-unsave="${esc(p.id)}">♥ 즐겨찾기에서 빼기</button>` : `<button data-save="${esc(p.id)}">♡ 즐겨찾기 저장</button>`);
    const km = C.distanceKm(here, p);
    return `${art(p)}<div class="muted" style="margin-top:12px">${metaLine(p, '지역 미확인')}${km != null ? ' <span class="muted">(현재 위치에서 직선거리)</span>' : ''}</div>` +
      `<h2>${esc(p.name)}</h2>${note ? `<p>${esc(note)}</p>` : ''}${badgeLine(p)}${pop}${p.naver && p.popularity && p.popularity.kind !== 'naver' ? `<div class="popbox">🟢 <b>${esc(p.naver)}</b><div class="muted">네이버 지역 검색(리뷰 많은 순)</div></div>` : ''}${p.addr ? `<p class="muted">📍 ${esc(p.addr)}${p.tel ? ' · ☎ ' + esc(p.tel) : ''}</p>` : ''}${hours}` +
      `<p class="muted">방문 전 운영시간·휴무·예약을 지도나 공식 홈페이지에서 꼭 확인해 주세요.</p>` +
      `<div class="row wrapline">${isEvent(p) ? `<a class="link primary" target="_blank" rel="noopener noreferrer" href="${esc(eventHref(p).href)}">🎪 ${eventHref(p).label}</a>` : ''}${mapButtons(p)}${actions}</div>`;
  }

  // ---------- 데이터 묶음 ----------
  const popularPool = () => C.discoverPool(live.places, C.SEED, []);
  function homeFilter(extra = {}) {
    return { env: ui.env, region: ui.region, ...extra };
  }
  function findPlace(id) {
    return saved.find((p) => p.id === id) || live.places.find((p) => p.id === id) || evData.list.find((p) => p.id === id) ||
      Object.values(nation.byArea).flat().find((p) => p.id === id) || Object.values(nation.foods).flat().find((p) => p.id === id) || C.SEED.find((p) => p.id === id);
  }

  // ---------- 화면: 공통 ----------
  function route() { const r = location.hash.replace('#', ''); return ['home', 'popular', 'events', 'food', 'saved', 'settings'].includes(r) ? r : 'home'; }
  function render() {
    const r = route();
    if (r !== 'saved' && selMode) { selMode = false; picked.clear(); }
    document.querySelectorAll('[data-page]').forEach((el) => { el.hidden = el.dataset.page !== r; });
    document.querySelectorAll('[data-tab]').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === (r === 'events' ? 'popular' : r) ? 'page' : 'false'));
    $('tabCount').hidden = !saved.length; $('tabCount').textContent = saved.length;
    $('title').textContent = r === 'home' ? '🌿 주말에 어디가지?' : r === 'popular' ? '🔥 요즘 인기' : r === 'events' ? '🎪 행사 모아보기' : r === 'food' ? '🍽 맛집' : r === 'saved' ? `⭐ 즐겨찾기 ${saved.length}곳` : '⚙️ 설정';
    $('topAction').innerHTML = r === 'home'
      ? `<select id="regionPill" class="pill" aria-label="지역">${C.REGIONS.map((x) => `<option value="${x.id}" ${x.id === ui.region ? 'selected' : ''}>📍 ${esc(x.label)}</option>`).join('')}</select>`
      : r === 'saved' ? '<button class="primary" data-open-import>＋ 가져오기</button>' : r === 'events' ? '<button class="ghost small" data-back>‹ 뒤로</button>' : '';
    selBar();
    if (r === 'home') renderHome(); else if (r === 'popular') renderPopular(); else if (r === 'events') renderEvents(); else if (r === 'food') renderFood(); else if (r === 'saved') renderSaved(); else renderSettings();
  }
  // 분류 한 줄: 전체 + 설정에서 고른 분류(박물관·체험·놀이·캠핑장·음식점…)
  // attr: data-hcat(요즘 인기·인기 탭) / data-rcat(즐겨찾기에서 추천)
  const catChips = (attr = 'data-hcat', cur = ui.homeCat) => `<button ${attr}="" class="${cur ? '' : 'active'}">전체</button>` +
    C.categories().filter((k) => ui.homeCats.includes(k) || cur === k)
      .map((k) => `<button ${attr}="${esc(k)}" class="${cur === k ? 'active' : ''}">${C.TYPES[k].icon} ${esc(C.shortLabel(k))}</button>`).join('');
  const envChips = () => [['', '전체'], ['실내', '☔ 실내'], ['야외', '☀️ 야외']]
    .map(([v, t]) => `<button data-env="${v}" class="${ui.env === v ? 'active' : ''}">${t}</button>`).join('');
  const popRows = () => C.filterPlaces(popularPool(), homeFilter({ category: ui.homeCat, outingOnly: true }))
    .sort((a, b) => ((b.popularity && b.popularity.score) || 0) - ((a.popularity && a.popularity.score) || 0));
  function showStatus(id) {
    const s = liveStatus();
    $(id).textContent = s.text; $(id).classList.toggle('off', s.off);
  }

  // ---------- 화면: 인기 (전체 목록) ----------
  // 세부 지역: 서울·경기 파일은 서울/경기로 나누고, 나머지는 파일(지역) 단위
  const SUBS = ['서울', '경기', 'incheon', 'gangwon', 'chung', 'jeolla', 'gyeong', 'jeju'];
  const subKey = (p) => ((p.area || 'sg') === 'sg' ? (C.regionToken(p) === '경기' ? '경기' : '서울') : p.area);
  const subLabel = (k) => { const r = C.REGIONS.find((x) => x.id === k); return r ? r.label : k; };
  const SUB_SHORT = { chung: '충청', jeolla: '전라', gyeong: '경상' };
  const subShort = (k) => SUB_SHORT[k] || subLabel(k);
  function nationRows() {
    const places = AREAS.flatMap((a) => nation.byArea[a] || []);
    // 인기 탭은 즐겨찾기에 저장한 곳도 그대로 보여줘요(♥ 표시). 홈 '요즘 인기'는 아직 저장 안 한 곳만.
    const pool = C.discoverPool(places, C.SEED.map((p) => ({ ...p, area: 'sg' })), []);
    return C.filterPlaces(pool, { category: ui.homeCat, env: ui.env, region: 'all', outingOnly: true })
      .sort((x, y) => ((y.popularity && y.popularity.score) || 0) - ((x.popularity && x.popularity.score) || 0));
  }
  function renderPopular() {
    loadNation(); loadEvents();
    if (evData.status === 'ok') $('evBannerSub').textContent = `전국 축제·행사 — ${evPeriods().map((x) => `${x.label} ${evRows(x).length}`).join(' · ')}`;
    $('popGroups').innerHTML = catChips();
    $('popEnv').innerHTML = envChips();
    const loading = nation.status !== 'ok';
    $('popStatus2').textContent = loading ? '전국 인기 장소를 불러오는 중…' : '이번 주말 행사(한국관광공사) · 티맵 연관 관광지 순위 · 매일 아침 업데이트';
    $('popStatus2').classList.remove('off');
    const all = loading ? [] : nationRows();
    const counts = countBy(all, subKey);
    const subs = SUBS.filter((k) => counts[k]);
    if (ui.popSub && !counts[ui.popSub]) ui.popSub = '';
    const rows = ui.popSub ? all.filter((p) => subKey(p) === ui.popSub) : all;
    const near = ui.popSort === 'near' && here;
    // 정렬 줄: 왼쪽은 지역 버튼(옆으로 밀어서 보기), 오른쪽은 인기순/거리순
    const chip = (k, t, n) => `<button data-psub="${esc(k)}" class="${ui.popSub === k ? 'active' : ''}">${esc(t)} <small>${n}</small></button>`;
    $('popBar').innerHTML = `<div class="row between sortline"><b>${esc(ui.popSub ? subLabel(ui.popSub) : '전국')} ${rows.length}곳</b>` +
      seg('data-psort', near ? 'near' : 'score', [['score', '인기순'], ['near', '거리순']]) + '</div>' +
      `<div class="chips barchips" role="group" aria-label="지역">${chip('', '전국', all.length)}${subs.map((k) => chip(k, subShort(k), counts[k])).join('')}</div>`;
    if (loading) { $('popAll').innerHTML = ''; return; }
    if (!rows.length) { $('popAll').innerHTML = '<div class="empty"><p>이 조건에 맞는 인기 장소가 없어요.</p></div>'; return; }
    // 지역은 위 버튼으로 고르니, 목록은 나누지 않고 인기순(또는 거리순) 하나로
    $('popAll').innerHTML = `<div class="list">${(near ? C.byDistance(rows, here) : rows).map(itemRow).join('')}</div>`;
  }

  // ---------- 화면: 맛집 ----------
  // 인기 맛집(티맵 연관 순위의 음식점, 순위 없는 지역은 관광공사 등록 음식점) + 내 즐겨찾기의 맛집·카페
  const FOOD_CAT = '맛집·카페';
  const isCafe = (p) => (p.kind ? /카페|찻집/.test(p.kind) : /카페|커피|coffee|cafe|베이커리|제과|빵|디저트|찻집/i.test(p.name));
  const FOOD_SRC = [['', '전체'], ['pop', '🔥 인기'], ['fav', '⭐ 즐겨찾기']];
  const FOOD_KIND = [['', '전체'], ['meal', '🍚 식당'], ['cafe', '☕ 카페']];
  function renderFood() {
    loadNation();
    const loading = nation.status !== 'ok';
    const favs = saved.filter((p) => p.category === FOOD_CAT);
    // 즐겨찾기에 있는 인기 맛집은 인기 쪽에 ♥로 한 번만 보여요.
    const popAll = loading ? [] : AREAS.flatMap((a) => nation.foods[a] || []).filter((p, i, a) => a.findIndex((x) => C.normName(x.name) === C.normName(p.name)) === i);
    const favOnly = favs.filter((f) => !popAll.some((p) => C.isDup(f, p)));
    const kindOk = (p) => (!ui.foodKind || (ui.foodKind === 'cafe') === isCafe(p)) && (!ui.foodKids || p.kids);
    const bySrc = { pop: popAll.filter(kindOk), fav: [...popAll.filter((p) => isSaved(p)), ...favOnly].filter(kindOk) };
    bySrc[''] = [...bySrc.pop, ...favOnly.filter(kindOk)];
    if (!bySrc[ui.foodSrc]) ui.foodSrc = '';
    const base = bySrc[ui.foodSrc];
    const regCounts = countBy(base, regionKey);
    const first = (r) => { const i = REGION_FIRST.indexOf(r); return i < 0 ? 99 : i; };
    const regs = Object.keys(regCounts).sort((a, b) => (a === UNKNOWN) - (b === UNKNOWN) || first(a) - first(b) || regCounts[b] - regCounts[a]);
    if (ui.foodReg && !regCounts[ui.foodReg]) ui.foodReg = '';
    const rows = ui.foodReg ? base.filter((p) => regionKey(p) === ui.foodReg) : base;
    const near = ui.foodSort === 'near' && here;
    const chips = (attr, cur, opts) => opts.map(([v, t, n]) => `<button ${attr}="${esc(v)}" class="${cur === v ? 'active' : ''}">${esc(t)}${n != null ? ` <small>${n}</small>` : ''}</button>`).join('');
    $('foodSrc').innerHTML = chips('data-foodsrc', ui.foodSrc, FOOD_SRC.map(([v, t]) => [v, t, bySrc[v].length]));
    $('foodKind').innerHTML = chips('data-foodkind', ui.foodKind, FOOD_KIND) + `<button data-foodkids class="${ui.foodKids ? 'active' : ''}">👶 놀이방</button>`;
    const note = AREAS.map((a) => nation.foodNote[a]).find((x) => /티맵/.test(x || ''));
    $('foodStatus').textContent = loading ? '맛집을 불러오는 중…' : `${note || '한국관광공사 데이터'}${popAll.some((p) => p.naver || (p.popularity && p.popularity.kind === 'naver')) ? ' · 네이버 리뷰 많은 순' : ''} · 프랜차이즈 제외`;
    $('foodBar').innerHTML = `<div class="row between sortline"><b>${esc(ui.foodReg || '전국')} ${rows.length}곳</b>` +
      seg('data-foodsort', near ? 'near' : 'score', [['score', '인기순'], ['near', '거리순']]) + '</div>' +
      `<div class="chips barchips" role="group" aria-label="지역">${chips('data-foodreg', ui.foodReg, [['', '전국', base.length], ...regs.map((r) => [r, r, regCounts[r]])])}</div>`;
    if (loading) { $('foodList').innerHTML = ''; return; }
    if (!rows.length) { $('foodList').innerHTML = `<div class="empty"><p>${ui.foodSrc === 'fav' ? '즐겨찾기에 맛집·카페가 없어요.<br>인기 맛집에서 ♡를 누르거나 지도 리스트를 가져와 보세요.' : '이 조건에 맞는 맛집이 없어요.'}</p></div>`; return; }
    if (near) { $('foodList').innerHTML = `<div class="list">${C.byDistance(rows, here).map(itemRow).join('')}</div>`; return; }
    // 인기순: 인기 맛집(점수 순) → 내 즐겨찾기 맛집(가나다순)
    const score = (p) => (p.popularity && p.popularity.score) || 0;
    const pops = rows.filter((p) => p.origin).sort((a, b) => score(b) - score(a));
    const mine = rows.filter((p) => !p.origin).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    $('foodList').innerHTML = [['🔥 인기 맛집', pops], ['⭐ 내 즐겨찾기 맛집', mine]].filter(([, l]) => l.length)
      .map(([t, l]) => `<div class="group-head"><h3>${t} <span class="muted">${l.length}곳</span></h3></div><div class="list">${l.map(itemRow).join('')}</div>`).join('');
  }

  // ---------- 화면: 행사 모아보기 ----------
  // 한국관광공사 행사정보(매일 아침 업데이트)를 이번 주말 / 이번 달 / 다음 달로 나눠 보여줘요.
  const ymdOf = (x) => `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`;
  const dateOf = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  const md = (s) => { const d = dateOf(s); return `${d.getMonth() + 1}.${d.getDate()}(${'일월화수목금토'[d.getDay()]})`; };
  const evDates = (e) => (e.start === e.end ? md(e.start) : `${md(e.start)} ~ ${md(e.end)}`);
  function evPeriods() {
    const now = new Date(); const d = now.getDay(); const today = ymdOf(now);
    const sat = new Date(now); sat.setDate(now.getDate() + (d === 0 ? -1 : 6 - d));
    const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const later = (a, b) => (a > b ? a : b);
    return [
      { id: 'weekend', label: '이번 주말', sub: `${sat.getMonth() + 1}/${sat.getDate()}–${sun.getMonth() + 1}/${sun.getDate()}`, from: later(today, ymdOf(sat)), to: ymdOf(sun), before: '주말 전부터 열리고 있어요', within: '이번 주말에 시작해요' },
      { id: 'month', label: '이번 달', sub: `${now.getMonth() + 1}월`, from: today, to: ymdOf(new Date(now.getFullYear(), now.getMonth() + 1, 0)), before: '지금 열리고 있어요', within: `${now.getMonth() + 1}월에 새로 시작해요` },
      { id: 'next', label: '다음 달', sub: `${next.getMonth() + 1}월`, from: ymdOf(next), to: ymdOf(new Date(next.getFullYear(), next.getMonth() + 1, 0)), before: '이번 달부터 이어져요', within: `${next.getMonth() + 1}월에 시작해요` },
    ];
  }
  const evRows = (per) => evData.list.filter((e) => e.start <= per.to && e.end >= per.from);
  function evPlace(e) {
    return {
      id: 'ev-' + e.id, name: e.name, category: '축제·행사', env: '야외', url: '', origin: 'live',
      region: e.region, area: e.area, lat: e.lat, lng: e.lng, image: e.image, homepage: e.homepage, start: e.start, end: e.end,
      note: e.overview || '', evLabel: evDates(e), evBadge: '행사',
      popularity: { kind: 'festival', label: `${evDates(e)} 열려요`, source: '한국관광공사 행사정보', basis: String((evData.meta && evData.meta.fetchedAt) || '').slice(0, 10), score: 0 },
      hours: { period: evDates(e), addr: e.addr, usetime: '', restdate: '', infocenter: e.tel, reservation: '', source: '한국관광공사 행사정보' },
    };
  }
  function evRow(p) {
    const today = ymdOf(new Date());
    const days = Math.round((dateOf(p.start) - dateOf(today)) / 86400000);
    const tag = p.start <= today ? '<span class="tag on">진행 중</span>' : `<span class="tag">${days === 1 ? '내일' : `D-${days}`}</span>`;
    const heart = heartBtn(p, 'heart-s');
    const ev = eventHref(p);
    return `<div class="item evrow"><div class="ico" style="background:#fbe2cf" aria-hidden="true">🎪${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>` +
      `<div class="txt" data-detail="${esc(p.id)}" role="button" tabindex="0"><b>${esc(p.name)}</b><span class="when">${esc(evDates(p))} ${tag}</span>` +
      `<span class="muted">${[distText(p), p.region].filter(Boolean).map(esc).join(' · ')}</span></div>` +
      `<div class="acts">${heart}<a class="link maplink" target="_blank" rel="noopener noreferrer" href="${esc(ev.href)}" aria-label="${esc(p.name)} ${ev.label}">${p.homepage ? '🎪 사이트' : '🔎 검색'}</a></div></div>`;
  }
  function renderEvents() {
    loadEvents();
    const pers = evPeriods();
    const per = pers.find((x) => x.id === ui.evWhen) || pers[0];
    const ok = evData.status === 'ok';
    $('evWhen').innerHTML = pers.map((x) => `<button data-evwhen="${x.id}" class="${x.id === per.id ? 'active' : ''}">${x.label} <small>${x.sub}${ok ? ` · ${evRows(x).length}건` : ''}</small></button>`).join('');
    const when = ok && evData.meta.fetchedAt ? new Date(evData.meta.fetchedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    $('evStatus').textContent = ok ? `한국관광공사 행사정보 · 전국 ${evData.list.length}건 · ${when} 업데이트`
      : evData.status === 'error' ? evData.error : evData.status === 'pending' ? '행사 데이터를 처음 만드는 중이에요(몇 분 걸려요).' : '행사 정보를 불러오는 중…';
    $('evStatus').classList.toggle('off', evData.status === 'error');
    const all = ok ? evRows(per) : [];
    const counts = countBy(all, subKey);
    const subs = SUBS.filter((k) => counts[k]);
    if (ui.evSub && !counts[ui.evSub]) ui.evSub = '';
    const rows = ui.evSub ? all.filter((p) => subKey(p) === ui.evSub) : all;
    const near = ui.evSort === 'near' && here;
    // 인기 화면과 같은 모양: 정렬 줄, 그 아래 지역 버튼 줄
    const chip = (k, t, n) => `<button data-esub="${esc(k)}" class="${ui.evSub === k ? 'active' : ''}">${esc(t)} <small>${n}</small></button>`;
    $('evBar').innerHTML = `<div class="row between sortline"><b>${esc(ui.evSub ? subLabel(ui.evSub) : '전국')} ${rows.length}건</b>` +
      seg('data-esort', near ? 'near' : 'date', [['date', '날짜순'], ['near', '거리순']]) + '</div>' +
      `<div class="chips barchips" role="group" aria-label="지역">${chip('', '전국', all.length)}${subs.map((k) => chip(k, subShort(k), counts[k])).join('')}</div>`;
    if (!ok) { $('evList').innerHTML = ''; return; }
    if (!rows.length) { $('evList').innerHTML = `<div class="empty"><p>${esc(per.label)}에 열리는 행사가 없어요.</p></div>`; return; }
    if (near) { $('evList').innerHTML = `<div class="list">${C.byDistance(rows, here).map(evRow).join('')}</div>`; return; }
    // 날짜순: 기간 안에 새로 시작하는 행사(시작하는 날 순)와 그 전부터 이어지는 행사(끝나는 날 순)로 나눠요.
    const within = rows.filter((p) => p.start >= per.from).sort((a, b) => a.start.localeCompare(b.start));
    const before = rows.filter((p) => p.start < per.from).sort((a, b) => a.end.localeCompare(b.end));
    $('evList').innerHTML = [[per.within, within], [per.before, before]].filter(([, l]) => l.length)
      .map(([t, l]) => `<div class="group-head"><h3>${esc(t)} <span class="muted">${l.length}건</span></h3></div><div class="list">${l.map(evRow).join('')}</div>`).join('');
  }

  // ---------- 화면: 홈 ----------
  function weekendText() {
    const now = new Date(); const d = now.getDay();
    const sat = new Date(now); sat.setDate(now.getDate() + (d === 0 ? -1 : 6 - d));
    const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
    const f = (x) => `${x.getMonth() + 1}/${x.getDate()}`;
    return `${d === 0 || d === 6 ? '이번 주말' : `주말까지 D-${6 - d}`} · ${f(sat)}(토)–${f(sun)}(일)`;
  }
  function renderHome() {
    $('weekendLabel').textContent = weekendText();
    $('homePopCats').innerHTML = catChips('data-hcat', ui.homeCat);
    $('homeFavCats').innerHTML = catChips('data-rcat', ui.favRecCat);
    $('homeEnv').innerHTML = envChips();

    // ① 인기 (홈에는 10곳만, 나머지는 '더보기' → 인기 탭)
    const pop = popRows();
    showStatus('popStatus');
    $('popMore').textContent = pop.length > 10 ? `더보기 ${pop.length} ›` : '더보기 ›';
    $('popList').innerHTML = pop.length ? pop.slice(0, 10).map(mini).join('')
      : `<div class="empty" style="flex:1"><p>이 조건에 맞는 인기 장소가 없어요.</p>${widenButtons()}</div>`;

    // ② 즐겨찾기에서
    const regionOk = C.filterPlaces(saved, homeFilter({ category: ui.favRecCat, allowUnknownRegion: true }));
    const showCats = ui.favRecCat ? [ui.favRecCat] : C.categories().filter((k) => ui.homeCats.includes(k));
    if (!saved.length) {
      $('favRecs').innerHTML = `<div class="empty"><p>네이버·구글지도에 저장해 둔 곳을 가져오면<br>분류별로 골라서 추천해 드려요.</p><button class="primary big" data-open-import>＋ 지도 즐겨찾기 가져오기</button></div>`;
      return;
    }
    const html = showCats.map((k) => {
      const rows = regionOk.filter((p) => p.category === k);
      if (!rows.length) return '';
      rows.forEach((p) => { if (!order.has(p.id)) order.set(p.id, Math.random()); });
      const mixed = [...rows].sort((a, b) => order.get(a.id) - order.get(b.id));
      // 사진이 다 있으면 카드로, 아니면(지도에서 가져온 곳은 대부분 사진이 없어요) 그림 없이 목록으로
      const cards = mixed.slice(0, 6).every((p) => p.image);
      const top = mixed.slice(0, cards ? 6 : 4);
      return `<div class="group-head"><h3>${C.TYPES[k].icon} ${esc(C.label(k))} <span class="muted">${rows.length}곳</span></h3><button class="ghost small" data-goto-cat="${esc(k)}">전체 보기 ›</button></div>` +
        (cards ? `<div class="scroller">${top.map(mini).join('')}</div>` : `<div class="list">${top.map(itemRow).join('')}</div>`);
    }).join('');
    $('favRecs').innerHTML = html || `<div class="empty"><p>지금 조건(${esc([condText(), ui.favRecCat && C.label(ui.favRecCat)].filter(Boolean).join(' · '))})에 맞는 즐겨찾기가 없어요.</p>${widenButtons(ui.favRecCat)}</div>`;
  }
  function widenButtons(cat = ui.homeCat) {
    const b = [];
    if (cat) b.push(`<button data-widen="${cat === ui.favRecCat ? 'favcat' : 'group'}">분류 전체</button>`);
    if (ui.env) b.push('<button data-widen="env">실내·야외 모두</button>');
    if (ui.region !== 'all') b.push('<button data-widen="region">전국으로 넓히기</button>');
    return `<div class="row wrapline" style="justify-content:center">${b.join('')}</div>`;
  }
  function condText() {
    const r = C.REGIONS.find((x) => x.id === ui.region);
    return [r && r.label, ui.env || '실내·야외 모두'].join(' · ');
  }
  function liveStatus() {
    if (live.status === 'loading') return { text: '최신 인기 장소를 불러오는 중… 그동안 기본 추천을 보여드려요.', off: false };
    if (live.status === 'pending') return { text: '인기 장소 데이터를 처음 만드는 중이에요(공공데이터 응답이 느려 몇 분 걸려요). 그동안 기본 추천을 보여드려요.', off: false };
    if (live.status === 'ok') {
      const when = new Date(live.meta.fetchedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return { text: `${live.meta.popularityNote || '한국관광공사 데이터'} · ${when} 업데이트${live.stale ? ' (이전에 받은 데이터)' : ''}`, off: !!live.stale };
    }
    return { text: '인기 장소 데이터에 아직 연결되지 않아 기본 추천(서울·경기 8곳)을 보여드려요.', off: true };
  }

  // ---------- 화면: 즐겨찾기 ----------
  // 목록 한 줄: 누르면 자세히(편집은 자세히 안에서), 오른쪽은 ♥/♡(빼기·저장)와 설정한 지도 앱으로 열기.
  // 맛집 배지: 네이버 리뷰 순위, 모범음식점, 백년가게, 어린이 놀이방
  const BADGE = { '모범음식점': '🏅 모범음식점', '백년가게': '💯 백년가게' };
  const badgeLine = (p) => {
    const b = [p.naver && p.popularity && p.popularity.kind !== 'naver' ? '🟢 ' + p.naver : '', ...(p.badges || []).map((x) => BADGE[x] || x), p.kids ? '👶 놀이방' : ''].filter(Boolean);
    return b.length ? `<span class="badges">${b.map((x) => `<i>${esc(x)}</i>`).join('')}</span>` : '';
  };
  // 여러 곳 선택(즐겨찾기 화면): 줄 앞 체크, 아래 막대에서 분류 바꾸기·빼기
  let selMode = false; const picked = new Set();
  function selBar() {
    const bar = $('selBar');
    bar.hidden = !(selMode && route() === 'saved');
    if (bar.hidden) return;
    const n = picked.size;
    bar.innerHTML = `<div class="wrap"><b>${n}곳 선택</b><button class="small ghost" data-sel-all>전체</button>` +
      `<select id="selCat" aria-label="선택한 곳 분류 바꾸기" ${n ? '' : 'disabled'}><option value="">분류 바꾸기…</option>${C.categories().map((k) => `<option value="${esc(k)}">${C.TYPES[k].icon} ${esc(C.label(k))}</option>`).join('')}</select>` +
      `<button class="small danger" data-sel-del ${n ? '' : 'disabled'}>빼기</button><button class="small primary" data-sel-done>완료</button></div>`;
  }
  function setPickedCategory(k) {
    if (!k || !picked.size || !C.TYPES[k]) return;
    const n = picked.size;
    const next = saved.map((p) => (picked.has(p.id) ? { ...p, category: k, env: C.TYPES[k].env || p.env || '', manual: true } : p));
    if (!persist(next)) return;
    picked.clear(); render(); toast(`${n}곳을 ‘${C.label(k)}’(으)로 옮겼어요`);
  }
  async function removePicked() {
    const list = saved.filter((p) => picked.has(p.id));
    if (!list.length) return;
    const imported = list.filter((p) => srcOf(p) !== 'app').length;
    if (!await ask(`선택한 ${list.length}곳을 즐겨찾기에서 뺄까요?${imported ? `\n네이버·구글 등에서 가져온 ${imported}곳은 제외 목록에 넣어서, 리스트를 다시 [업데이트]해도 들어오지 않아요. 설정 → 제외한 즐겨찾기에서 되돌릴 수 있어요.` : ''}`, `${list.length}곳 빼기`)) return;
    if (removePlaces(list)) { picked.clear(); render(); toast(`${list.length}곳을 뺐어요`); }
  }
  function itemRow(p) {
    const t = T(p);
    if (selMode && route() === 'saved' && !p.origin) {
      const on = picked.has(p.id);
      return `<label class="item pick ${on ? 'on' : ''}"><input type="checkbox" data-pick="${esc(p.id)}" ${on ? 'checked' : ''}>` +
        `<div class="ico" style="background:${t.bg}" aria-hidden="true">${t.icon}</div><div class="txt"><b>${esc(p.name)}</b><span class="muted">${esc(SRC[srcOf(p)])} · ${metaLine(p, '지역 미확인')}</span></div></label>`;
    }
    const heart = heartBtn(p, 'heart-s');
    // 내 즐겨찾기 줄에는 어디서 가져왔는지 앞에 표시
    const own = !p.origin && saved.some((x) => x.id === p.id);
    return `<div class="item"><div class="ico" style="background:${t.bg}" aria-hidden="true">${t.icon}</div>` +
      `<div class="txt" data-detail="${esc(p.id)}" role="button" tabindex="0"><b>${esc(p.name)}</b><span class="muted">${own ? esc(SRC[srcOf(p)]) + ' · ' : ''}${metaLine(p, '지역 미확인')}</span>` +
      popLine(p) + badgeLine(p) + '</div>' +
      `<div class="acts">${heart}${mapLink(p)}</div></div>`;
  }
  const UNKNOWN = '지역 미확인';
  const REGION_FIRST = ['서울', '경기', '인천', '강원'];
  const regionKey = (p) => C.regionToken(p) || UNKNOWN;
  const countBy = (rows, key) => rows.reduce((m, p) => { const k = key(p); m[k] = (m[k] || 0) + 1; return m; }, {});
  // 즐겨찾기: 출처(전체·네이버·구글·이 앱) → 분류(전체 포함) → 지역(전체 포함)
  const inSrc = () => (ui.favSrc ? saved.filter((p) => srcOf(p) === ui.favSrc) : saved);
  function favRows() {
    const base = inSrc();
    const inCat = ui.favCat ? base.filter((p) => p.category === ui.favCat) : base;
    const inRegion = ui.favRegion ? inCat.filter((p) => regionKey(p) === ui.favRegion) : inCat;
    return { inCat, rows: C.filterPlaces(inRegion, { q: $('search').value }) };
  }
  function renderSaved() {
    const srcCounts = countBy(saved, srcOf);
    const srcs = Object.keys(SRC).filter((k) => srcCounts[k]);
    if (ui.favSrc && !srcCounts[ui.favSrc]) ui.favSrc = '';
    $('favSrc').hidden = srcs.length < 2;
    $('favSrc').innerHTML = `<button data-fsrc="" class="${ui.favSrc ? '' : 'active'}">전체 ${saved.length}</button>` +
      srcs.map((k) => `<button data-fsrc="${k}" class="${ui.favSrc === k ? 'active' : ''}">${SRC[k]} ${srcCounts[k]}</button>`).join('');
    const base = inSrc();
    const catCounts = countBy(base, (p) => p.category);
    const cats = C.categories().filter((k) => catCounts[k]);
    if (ui.favCat && !catCounts[ui.favCat]) { ui.favCat = ''; ui.favRegion = ''; }
    $('favGroups').innerHTML = `<button data-fcat="" class="${ui.favCat ? '' : 'active'}">전체 ${base.length}</button>` +
      cats.map((k) => `<button data-fcat="${esc(k)}" class="${ui.favCat === k ? 'active' : ''}">${C.TYPES[k].icon} ${esc(C.shortLabel(k))} ${catCounts[k]}</button>`).join('');
    if (!saved.length) {
      $('favRegion').innerHTML = ''; $('favMap').hidden = true; $('favBulk').hidden = true;
      $('favList').innerHTML = `<div class="empty" style="margin-top:14px"><p>아직 저장한 곳이 없어요.<br>네이버·구글지도 리스트 링크만 붙이면 한 번에 정리해 드려요.</p><button class="primary big" data-open-import>＋ 지도 즐겨찾기 가져오기</button></div>`;
      return;
    }
    const { inCat, rows } = favRows();
    const regCounts = countBy(inCat, regionKey);
    // 서울·경기·인천·강원을 앞에, 나머지는 많은 순, '지역 미확인'은 맨 뒤
    const first = (r) => { const i = REGION_FIRST.indexOf(r); return i < 0 ? 99 : i; };
    const regs = Object.keys(regCounts).sort((a, b) => (a === UNKNOWN) - (b === UNKNOWN) || first(a) - first(b) || regCounts[b] - regCounts[a]);
    if (ui.favRegion && !regCounts[ui.favRegion]) ui.favRegion = '';
    $('favRegion').innerHTML = `<button data-freg="" class="${ui.favRegion ? '' : 'active'}">📍 전체 ${inCat.length}</button>` +
      regs.map((r) => `<button data-freg="${esc(r)}" class="${ui.favRegion === r ? 'active' : ''}">${esc(r)} ${regCounts[r]}</button>`).join('');
    const located = rows.filter((p) => p.lat != null).length;
    $('favMap').hidden = false;
    $('favBulk').hidden = !rows.length;
    $('favBulk').innerHTML = (selMode ? '' : '<button class="ghost small" data-sel-start>☑ 여러 곳 선택</button>') +
      ((ui.favCat || ui.favSrc || ui.favRegion) && !selMode ? `<button class="ghost small danger" data-exclude-shown>🚫 이 목록 ${rows.length}곳 모두 빼기</button>` : '');
    const near = ui.favOrder === 'near' && here;
    $('favMap').innerHTML = `<span class="row"><span class="muted">${rows.length}곳</span>` +
      seg('data-fsort', near ? 'near' : 'name', [['near', '거리순'], ['name', '가나다순']]) + '</span>' +
      `<button class="primary small" data-show-map ${rows.length ? '' : 'disabled'}>🗺 지도에서 보기${located < rows.length ? ` (${located}/${rows.length})` : ''}</button>`;
    const sortRows = (list) => (near ? C.byDistance(list, here) : [...list].sort((a, b) => a.name.localeCompare(b.name, 'ko')));
    const html = ui.favCat || cats.length < 2 || near || selMode
      ? `<div class="list">${sortRows(rows).map(itemRow).join('')}</div>`
      : cats.map((k) => {
        const list = sortRows(rows.filter((p) => p.category === k));
        return list.length ? `<div class="group-head"><h3>${C.TYPES[k].icon} ${esc(C.label(k))} <span class="muted">${list.length}</span></h3></div><div class="list">${list.map(itemRow).join('')}</div>` : '';
      }).join('');
    $('favList').innerHTML = rows.length ? html : '<div class="empty" style="margin-top:14px"><p>조건에 맞는 곳이 없어요.</p></div>';
    for (const id of picked) if (!saved.some((p) => p.id === id)) picked.delete(id);
    selBar();
  }

  // ---------- 지도에서 보기 ----------
  let leafletReady = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletReady) return leafletReady;
    leafletReady = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      js.onload = resolve; js.onerror = () => { leafletReady = null; reject(new Error('지도를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')); };
      document.head.appendChild(js);
    });
    return leafletReady;
  }
  let map = null, layer = null;
  async function showMap(rows, title) {
    const pts = rows.filter((p) => p.lat != null && p.lng != null);
    $('mapTitle').textContent = title;
    $('mapNote').textContent = pts.length < rows.length
      ? `위치가 있는 ${pts.length}곳만 표시해요. 나머지 ${rows.length - pts.length}곳은 설정 → 가져온 지도 리스트 → 업데이트로 위치를 채울 수 있어요.`
      : `${pts.length}곳`;
    $('mapDlg').showModal();
    try { await loadLeaflet(); } catch (e) { $('mapNote').textContent = e.message; return; }
    if (!map) {
      map = L.map('mapBox', { zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
    }
    if (layer) layer.remove();
    layer = L.featureGroup(pts.map((p) => {
      const t = T(p); const m = mapHref(p);
      return L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'pin', html: `<span style="background:${t.bg}">${t.icon}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] }) })
        .bindPopup(`<b>${esc(p.name)}</b><br><span class="muted">${metaLine(p)}</span><br><a target="_blank" rel="noopener noreferrer" href="${esc(m.href)}">${esc(m.label)}에서 열기</a> · <a href="#" data-detail="${esc(p.id)}">자세히</a>`);
    }));
    if (here) layer.addLayer(L.circleMarker([here.lat, here.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#2f6fe0', fillOpacity: 1 }).bindPopup('현재 위치'));
    layer.addTo(map);
    setTimeout(() => {
      map.invalidateSize();
      if (pts.length) map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 14 }); else map.setView([37.55, 126.98], 10);
    }, 60);
  }

  // ---------- 화면: 설정 ----------
  function renderSettings() {
    $('setRegion').innerHTML = C.REGIONS.map((x) => `<option value="${x.id}" ${x.id === ui.region ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
    $('setMapApp').innerHTML = seg('data-mapapp', ui.mapApp, Object.entries(MAP_APPS));
    $('setGroups').innerHTML = C.categories().map((k) => {
      const c = ui.customGroups.find((x) => x.label === k);
      const words = c && c.words.length ? `<span class="muted"> · 이름에 ‘${esc(c.words.join(', '))}’</span>` : '';
      return `<div class="row between grouprow"><label class="row"><input type="checkbox" data-hc="${esc(k)}" ${ui.homeCats.includes(k) ? 'checked' : ''}> ${C.TYPES[k].icon} ${esc(C.label(k))}${words}</label>` +
        (c ? `<button class="small ghost" data-del-group="${c.id}" aria-label="${esc(k)} 분류 지우기">✕</button>` : '') + '</div>';
    }).join('');
    $('setAccount').innerHTML = accountHtml();
    if (!sb) initAuth();
    const s = liveStatus();
    $('setLive').textContent = live.status === 'ok' ? `연결됨 — ${s.text}` : live.status === 'loading' ? '불러오는 중…' : `연결 안 됨 — 기본 추천만 보여요.${live.error ? ` (${live.error})` : ''}`;
    const ex = readExcluded();
    $('setExcluded').innerHTML = ex.length
      ? `<details><summary>${ex.length}곳 보기</summary><div class="exlist">${ex.map((x, i) => `<div class="prow"><div class="txt"><b>${esc(x.place.name)}</b><span class="muted">${esc(SRC[srcOf(x.place)])} · ${esc(C.label(x.place.category))}${x.place.region ? ' · ' + esc(x.place.region) : ''}</span></div><button class="small" data-restore="${i}">되돌리기</button></div>`).join('')}</div>` +
        '<div class="row" style="margin-top:8px"><button class="small ghost" data-restore="all">모두 되돌리기</button></div></details>'
      : '<p class="muted">즐겨찾기에서 ♥를 눌러 뺀 곳(네이버·구글에서 가져온 곳)이 여기에 모여요. 리스트를 다시 가져오거나 [업데이트]해도 이 곳들은 들어오지 않아요.</p>';
    const lists = readLists();
    $('setLists').innerHTML = lists.length ? lists.map((l) => `<div class="prow"><div class="txt"><b>${l.provider === 'naver' ? '🟢' : '🔵'} ${esc(l.name)}</b>` +
      // 지금 즐겨찾기에 남아 있는 수(뺀 곳은 빠져요)와 제외한 수
      `<span class="muted">${saved.filter((p) => p.list === l.name).length}곳${(() => { const k = ex.filter((x) => x.place.list === l.name).length; return k ? ` · 제외 ${k}곳` : ''; })()} · ${new Date(l.updatedAt).toLocaleDateString('ko-KR')} 업데이트</span></div>` +
      `<button class="small" data-list-update="${esc(l.url)}">업데이트</button><button class="small ghost" data-list-forget="${esc(l.url)}" aria-label="${esc(l.name)} 잊기">✕</button></div>`).join('')
      : '<p class="muted">리스트 링크로 가져오면 여기에 기억해 두고, 다음부터는 [업데이트] 한 번으로 새로 추가한 곳만 가져와요.</p>';
    $('setHere').textContent = hereStatus === 'insecure' ? '거리 표시: 이 주소(http)에서는 위치를 쓸 수 없어요. https 주소로 배포하면 자동으로 보여요.'
      : hereStatus === 'denied' ? '거리 표시: 위치 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 위치를 허용해 주세요.'
      : here ? `거리 표시: 현재 위치 기준 직선거리 (${new Date(here.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })} 위치)` : '거리 표시: 위치를 확인하는 중이에요.';
    $('setData').textContent = user ? `즐겨찾기 ${saved.length}곳 · 이 기기와 계정에 함께 저장돼요. 백업 파일도 따로 저장해 둘 수 있어요.` : `즐겨찾기 ${saved.length}곳이 이 기기 브라우저에 저장돼 있어요. 로그인하거나 백업 파일로 다른 기기에 옮길 수 있어요.`;
  }

  // ---------- 저장 ----------
  function saveCandidates(items) {
    const { next, report } = C.mergeImport(saved, items);
    if (!persist(next)) return null;
    return report;
  }
  function saveFromPool(id) {
    const p = findPlace(id);
    if (!p) return;
    writeExcluded(readExcluded().filter((x) => !hits(x, p)));
    const r = saveCandidates([{ name: p.name, url: p.url, category: p.category, env: p.env, region: p.region, note: p.note, source: p.origin === 'live' ? 'popular' : 'seed', list: '인기 장소에서 저장' }]);
    if (r) toast(r.added.length ? `‘${p.name}’을(를) 즐겨찾기에 저장했어요` : '이미 저장된 곳이에요');
  }

  // ---------- 상세·편집 ----------
  function openDetail(id) {
    const p = findPlace(id);
    if (!p) return;
    $('detailKind').textContent = saved.some((s) => s.id === id) ? '내 즐겨찾기' : p.origin === 'seed' ? '기본 추천' : '인기 장소';
    $('detailBody').innerHTML = detailHtml(p);
    $('detailDlg').showModal();
  }
  let editingId = null;
  function fillCategories() {
    $('eCategory').innerHTML = C.categories().map((k) => `<option value="${esc(k)}">${C.TYPES[k].icon} ${esc(C.label(k))}</option>`).join('');
  }
  fillCategories();

  // ---------- 분류 추가·삭제 (설정) ----------
  function applyCustom() { C.setCustom(ui.customGroups); fillCategories(); }
  $('ngSave').onclick = () => {
    const label = $('ngName').value.trim().slice(0, 12);
    if (!label) { toast('분류 이름을 넣어 주세요'); $('ngName').focus(); return; }
    if (C.TYPES[label] || C.categories().some((k) => C.shortLabel(k) === label || C.label(k) === label)) { toast('이미 있는 분류 이름이에요'); return; }
    const words = $('ngWords').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 10);
    const g = { id: 'u' + Date.now().toString(36), label, icon: $('ngIcon').value, words };
    ui.customGroups = [...ui.customGroups, g];
    ui.homeCats = [...ui.homeCats, label];
    applyCustom();
    // 이미 저장된 곳 중 이름에 단어가 들어간 곳을 옮겨요(분류를 직접 고른 곳은 그대로).
    let moved = 0;
    const next = saved.map((p) => {
      if (p.manual || !words.some((w) => p.name.includes(w))) return p;
      moved++; return { ...p, category: label };
    });
    if (moved) persist(next);
    saveUi();
    $('ngName').value = ''; $('ngWords').value = ''; $('addGroupBox').open = false;
    render();
    toast(moved ? `‘${label}’ 분류를 만들고 즐겨찾기 ${moved}곳을 옮겼어요` : `‘${label}’ 분류를 만들었어요. 장소 자세히의 ✏️ 분류·편집에서 옮길 수 있어요`);
  };
  async function removeGroup(id) {
    const g = ui.customGroups.find((x) => x.id === id);
    if (!g) return;
    const n = saved.filter((p) => p.category === g.label).length;
    if (!await ask(`‘${g.label}’ 분류를 지울까요?${n ? `\n이 분류의 즐겨찾기 ${n}곳은 지우지 않고 원래 규칙대로 다시 분류해요.` : ''}`, '지우기')) return;
    ui.customGroups = ui.customGroups.filter((x) => x.id !== id);
    ui.homeCats = ui.homeCats.filter((x) => x !== g.label);
    if (ui.homeCat === g.label) ui.homeCat = '';
    if (ui.favRecCat === g.label) ui.favRecCat = '';
    if (ui.favCat === g.label) { ui.favCat = ''; ui.favRegion = ''; }
    applyCustom();
    if (n) persist(saved.map((p) => { if (p.category !== g.label) return p; const c = C.infer(p.name, p.note); return { ...p, category: c, env: C.TYPES[c].env, manual: false }; }));
    saveUi(); render(); toast(`‘${g.label}’ 분류를 지웠어요`);
  }
  function openEdit(id) {
    const p = saved.find((x) => x.id === id);
    if (!p) return;
    editingId = id;
    $('eName').value = p.name; $('eCategory').value = p.category; $('eEnv').value = p.env || '';
    $('eRegion').value = p.region || ''; $('eUrl').value = p.url || ''; $('eNote').value = p.note || '';
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    $('editDlg').showModal();
  }
  $('eCategory').onchange = () => { $('eEnv').value = C.TYPES[$('eCategory').value].env; };
  $('editForm').onsubmit = (e) => {
    e.preventDefault();
    const raw = $('eUrl').value.trim();
    if (raw && !C.validUrl(raw)) { $('eUrl').setCustomValidity('https:// 로 시작하는 링크를 넣어 주세요'); $('eUrl').reportValidity(); $('eUrl').setCustomValidity(''); return; }
    const env = $('eEnv').value;
    const next = saved.map((p) => {
      if (p.id !== editingId) return p;
      const np = C.makePlace({ ...p, name: $('eName').value, category: $('eCategory').value, region: $('eRegion').value, url: raw, note: $('eNote').value, manual: p.manual || $('eCategory').value !== p.category });
      np.env = env; // '모름'은 빈 값 그대로
      return np;
    });
    if (persist(next)) { $('editDlg').close(); render(); toast('저장했어요'); }
  };
  $('eDelete').onclick = async () => {
    const p = saved.find((x) => x.id === editingId);
    if (!p || !await ask(`‘${p.name}’을(를) 즐겨찾기에서 삭제할까요?`, '삭제')) return;
    if (persist(saved.filter((x) => x.id !== editingId))) { $('editDlg').close(); render(); toast('삭제했어요'); }
  };

  // ---------- 한 곳 골라줘 ----------
  function pickPool() {
    const f = homeFilter({ outingOnly: true, allowUnknownRegion: true });
    const mine = ui.pickFrom === 'new' ? [] : C.filterPlaces(saved, f);
    const fresh = ui.pickFrom === 'mine' ? [] : C.filterPlaces(popularPool().filter((p) => !isSaved(p)), f);
    return [...mine, ...fresh];
  }
  function doPick() {
    $('pickFrom').innerHTML = [['all', '전체'], ['mine', '⭐ 즐겨찾기에서'], ['new', '🔥 새로운 곳에서']]
      .map(([v, t]) => `<button data-pickfrom="${v}" class="${ui.pickFrom === v ? 'active' : ''}">${t}</button>`).join('');
    const rows = pickPool();
    const p = C.pickOne(rows, lastPickId);
    lastPickId = p && p.id;
    $('pickConds').textContent = `${condText()} — 후보 ${rows.length}곳 중에서 골랐어요.`;
    $('pickBody').innerHTML = p ? detailHtml(p)
      : `<div class="empty"><p>지금 조건에 맞는 후보가 없어요.</p><p class="muted">${ui.pickFrom === 'mine' && !saved.length ? '즐겨찾기가 비어 있어요. 먼저 지도 즐겨찾기를 가져오거나 ‘전체’에서 골라 보세요.' : '실내·야외·지역 조건을 넓혀 보세요.'}</p>${widenButtons('')}</div>`;
    $('reroll').disabled = rows.length < 2;
    if (!$('pickDlg').open) $('pickDlg').showModal();
  }

  // ---------- 가져오기 ----------
  function openImport(prefill) {
    $('importStart').hidden = false; $('importPreview').hidden = true; $('importReport').hidden = true;
    if (prefill != null) $('paste').value = prefill;
    if (!$('importDlg').open) $('importDlg').showModal();
  }
  async function fetchList(url) {
    const res = await fetch(`${IMPORT_LIST}?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(25000) });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) {
      if (res.status === 404 && !data) throw new Error('리스트 읽기 서버가 연결되지 않았어요(README의 서버 설정 참고). 장소 공유 문구로 붙여 넣거나 파일로 가져와 주세요.');
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    return data;
  }
  async function runPaste() {
    const text = $('paste').value.trim();
    if (!text) { toast('링크나 공유 문구를 붙여 넣어 주세요'); return; }
    const btn = $('pasteGo'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 불러오는 중…';
    try {
      const parsed = C.fromShareText(text);
      const candidates = [];
      for (const c of parsed) {
        if (!c.linkOnly) { candidates.push(c); continue; }
        // 이름 없이 링크만 있으면 리스트 링크로 보고 서버에서 읽어 와요.
        try {
          const list = await fetchList(c.url);
          rememberList(c.url, list);
          list.places.forEach((p) => candidates.push({ ...p, list: list.listName, source: list.provider + '-list' }));
          if (!list.places.length) candidates.push({ error: `${list.listName}: 장소가 없어요` });
        } catch (e) { candidates.push({ error: e.message }); }
      }
      if (!candidates.length) candidates.push({ error: '붙여 넣은 내용에서 장소를 찾지 못했어요.' });
      showPreview(candidates, '붙여넣기');
    } finally { btn.disabled = false; btn.textContent = '불러오기'; }
  }
  // 가져온 지도 리스트 링크 기억하기 → 설정에서 [업데이트] 한 번으로 새 장소만 추가
  const LISTS_KEY = 'weekend-lists-v1';
  function readLists() { try { return JSON.parse(localStorage.getItem(LISTS_KEY) || '[]'); } catch { return []; } }
  function writeLists(v) { try { localStorage.setItem(LISTS_KEY, JSON.stringify(v)); markDirty(); } catch { /* 선택 */ } }
  function rememberList(url, list) {
    const rest = readLists().filter((x) => x.url !== url && !(x.provider === list.provider && x.name === list.listName));
    writeLists([...rest, { url, provider: list.provider, name: list.listName, count: list.places.length, updatedAt: new Date().toISOString() }]);
  }
  async function forgetList(url) {
    if (!await ask('이 리스트 링크를 잊을까요? 이미 저장한 장소는 그대로 남아요.', '잊기')) return;
    writeLists(readLists().filter((x) => x.url !== url)); render();
  }
  async function updateList(url, btn) {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const list = await fetchList(url);
      rememberList(url, list);
      openImport();
      showPreview(list.places.map((p) => ({ ...p, list: list.listName, source: list.provider + '-list' })), list.listName);
    } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = '업데이트'; render(); }
  }

  function showPreview(candidates, from) {
    const ex = readExcluded();
    const skipped = candidates.filter((c) => !c.error && c.name && ex.some((x) => hits(x, c)));
    preview = C.previewImport(saved, candidates.filter((c) => !skipped.includes(c)));
    const n = preview.filter((x) => x.status === 'new').length;
    const d = preview.filter((x) => x.status === 'dup').length;
    const e = preview.filter((x) => x.status === 'error');
    if (!n && !d) { showReport({ added: [], duplicates: [], warnings: [], errors: e, located: [], excluded: skipped.length }, `${from} 결과`); return; }
    if (!n) { // 새 장소가 없으면 미리보기 없이 위치 정보만 채우고 결과를 보여줘요
      const r = saveCandidates(preview.filter((x) => x.status === 'dup').map((x) => x.place));
      if (r) { r.errors.push(...e); r.excluded = skipped.length; showReport(r, `${from}: 새로 추가된 곳이 없어요`); render(); }
      return;
    }
    $('pvSummary').innerHTML = `불러온 장소 <b>${n + d}곳</b> — 새로 ${n}곳, 이미 저장됨 ${d}곳${skipped.length ? `, 제외 목록이라 건너뜀 ${skipped.length}곳` : ''}${e.length ? `, 오류 ${e.length}건` : ''}. 분류를 확인하고 저장할 곳을 고르세요.`;
    preview.excluded = skipped.length;
    const catOpts = (sel) => Object.keys(C.TYPES).map((k) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${C.TYPES[k].icon} ${esc(C.label(k))}</option>`).join('');
    $('pvList').innerHTML = preview.map((x) => x.status === 'error'
      ? `<div class="prow"><span class="tag err">오류</span><div class="txt muted">${esc((x.file ? x.file + ' ' : '') + (x.line ? x.line + '번째 줄: ' : '') + x.error)}</div></div>`
      : `<label class="prow"><input type="checkbox" data-pv="${x.key}" ${x.status === 'new' ? 'checked' : 'disabled'}>` +
        `<div class="txt"><b>${esc(x.place.name)}</b><span class="muted">${esc(x.place.region || '지역 미확인')}</span>` +
        `${x.status === 'dup' ? ' <span class="tag dup">이미 저장됨</span>' : ''}${x.warning ? ` <span class="tag">${esc(x.warning)}</span>` : ''}</div>` +
        (x.status === 'new' ? `<select data-pvcat="${x.key}" aria-label="분류">${catOpts(x.place.category)}</select>` : '') + '</label>').join('');
    updatePvButton();
    $('importStart').hidden = true; $('importPreview').hidden = false;
  }
  function updatePvButton() {
    const k = document.querySelectorAll('[data-pv]:checked').length;
    $('pvSave').textContent = `${k}곳 저장`; $('pvSave').disabled = !k;
  }
  $('pvBack').onclick = () => { $('importStart').hidden = false; $('importPreview').hidden = true; };
  $('pvSave').onclick = () => {
    const chosen = new Set([...document.querySelectorAll('[data-pv]:checked')].map((x) => x.dataset.pv));
    const items = preview.filter((x) => chosen.has(x.key)).map((x) => {
      const sel = document.querySelector(`[data-pvcat="${x.key}"]`);
      const cat = sel ? sel.value : x.place.category;
      return cat !== x.place.category ? { ...x.place, category: cat, env: '', manual: true } : x.place;
    });
    // 이미 저장된 곳도 함께 넘겨 비어 있던 위치(지도 보기용)를 채워요 — 중복으로 추가되지는 않아요.
    const r = saveCandidates([...items, ...preview.filter((x) => x.status === 'dup').map((x) => x.place)]);
    if (!r) return;
    r.errors.push(...preview.filter((x) => x.status === 'error'));
    r.excluded = preview.excluded || 0;
    $('paste').value = '';
    $('importStart').hidden = false; $('importPreview').hidden = true;
    showReport(r, '가져오기 결과');
    render();
  };
  function showReport(report, title) {
    const list = (arr, max = 6) => arr.length ? `<ul>${arr.slice(0, max).map((x) => `<li>${esc(x)}</li>`).join('')}${arr.length > max ? `<li>…외 ${arr.length - max}개</li>` : ''}</ul>` : '';
    const errs = report.errors.map((e) => `${e.file ? e.file + ' ' : ''}${e.line ? e.line + '번째 줄: ' : ''}${e.error}`);
    $('importReport').innerHTML = `<b>${esc(title)}</b><div>✅ 추가 ${report.added.length}곳</div>` +
      `<div>↩️ 이미 저장되어 건너뜀 ${report.duplicates.length}곳</div>${list(report.duplicates)}` +
      (report.excluded ? `<div>🚫 제외 목록에 있어 건너뜀 ${report.excluded}곳</div>` : '') +
      `<div>⚠️ 오류로 건너뜀 ${report.errors.length}건</div>${list(errs)}` +
      (report.located && report.located.length ? `<div>📍 이미 저장된 ${report.located.length}곳에 지도 위치를 채웠어요</div>` : '') +
      (report.added.length ? '<div class="row" style="margin-top:8px"><button class="primary" data-goto-saved>즐겨찾기 보기</button></div>' : '');
    $('importReport').hidden = false;
    $('importStart').hidden = false; $('importPreview').hidden = true;
    if (!$('importDlg').open) $('importDlg').showModal();
    $('importReport').scrollIntoView({ block: 'nearest' });
  }
  async function readFiles(files) {
    const candidates = [];
    for (const file of files) {
      const listName = file.name.replace(/\.(csv|json|geojson)$/i, '');
      try {
        if (file.size > 5_000_000) throw new Error('5MB보다 큰 파일이에요.');
        const text = await file.text();
        let rows;
        if (/^\s*[[{]/.test(text)) {
          const json = JSON.parse(text);
          rows = json && json.app === 'weekend-outing' ? C.parseBackup(text) : C.fromGeoJson(text, listName);
        } else rows = C.fromCsv(text, listName);
        rows.forEach((r) => { if (r.error) r.file = file.name; candidates.push(r); });
      } catch (err) {
        candidates.push({ file: file.name, error: (err && err.message) || '읽을 수 없는 파일이에요.' });
      }
    }
    return candidates;
  }
  $('fileIn').onchange = async (e) => {
    const files = [...e.target.files];
    if (files.length) showPreview(await readFiles(files), `파일 ${files.length}개`);
    e.target.value = '';
  };

  // ---------- 설정 동작 ----------
  $('setRegion').onchange = () => { ui.region = $('setRegion').value; saveUi(); loadLive(); render(); };
  $('setReload').onclick = () => { try { localStorage.removeItem(C.LIVE_CACHE_KEY); } catch { /* */ } loadLive(true); loadNation(true); loadEvents(true); };
  $('backupSave').onclick = () => {
    const blob = new Blob([C.exportBackup(saved)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `주말나들이-백업-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('backupLoad').onchange = async (e) => {
    const files = [...e.target.files];
    if (files.length) { openImport(); showPreview(await readFiles(files), '백업'); }
    e.target.value = '';
  };
  $('wipe').onclick = async () => {
    if (!saved.length || !await ask(`즐겨찾기 ${saved.length}곳을 모두 지울까요? 되돌릴 수 없어요. (먼저 백업 파일을 저장해 두는 걸 권해요)`, '모두 지우기')) return;
    if (persist([])) { render(); toast('모두 지웠어요'); }
  };

  // ---------- 로그인·동기화 (Supabase 이메일 링크) ----------
  // 즐겨찾기·제외 목록·가져온 리스트·설정을 계정 하나(weekend_data 표의 내 줄)에 통째로 저장해요.
  // 다른 기기에서 바뀐 게 있으면 받아오고, 이 기기에서 바꾸면 2초 뒤 올려요. 처음 로그인하는 기기는 양쪽을 합쳐요.
  const SB_URL = String(CONFIG.supabaseUrl || '').replace(/\/+$/, '');
  const SB_KEY = CONFIG.supabaseAnonKey || '';
  const SYNC_KEY = 'weekend-sync-v1';
  const SB_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  let sb = null;
  // var: 앱 시작 직후(이 줄보다 먼저) 저장이 일어나도 오류 없이 넘어가게
  var user = null; var applying = false; var pushTimer = null; var lastUiSig;
  const sync = { busy: false, err: '', sent: false };
  const readSync = () => { try { return JSON.parse(localStorage.getItem(SYNC_KEY) || '{}') || {}; } catch { return {}; } };
  const writeSync = (v) => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(v)); } catch { /* 선택 */ } };
  const UI_SYNC = ['region', 'mapApp', 'homeCats', 'customGroups'];
  function snapshot() {
    return { v: 1, places: saved, excluded: readExcluded(), lists: readLists(), ui: Object.fromEntries(UI_SYNC.map((k) => [k, ui[k]])) };
  }
  function applySnapshot(d) {
    applying = true;
    try {
      if (Array.isArray(d.places)) persist(d.places, true);
      if (Array.isArray(d.excluded)) writeExcluded(d.excluded);
      if (Array.isArray(d.lists)) writeLists(d.lists);
      if (d.ui) { for (const k of UI_SYNC) if (d.ui[k] !== undefined) ui[k] = d.ui[k]; saveUi(); applyCustom(); }
    } finally { applying = false; }
  }
  // 두 기기 내용 합치기(같은 곳은 한 번만). 지운 것은 되살아날 수 있어서 처음 로그인할 때·충돌 때만 써요.
  function mergeSnap(a, b) {
    const places = [...(a.places || [])];
    for (const p of b.places || []) if (!places.some((x) => x.id === p.id || C.isDup(x, p))) places.push(p);
    const excluded = [...(a.excluded || [])];
    for (const x of b.excluded || []) if (!excluded.some((y) => (y.keys || []).some((k) => (x.keys || []).includes(k)))) excluded.push(x);
    const lists = [...(a.lists || [])];
    for (const l of b.lists || []) if (!lists.some((y) => y.url === l.url)) lists.push(l);
    return { v: 1, places, excluded, lists, ui: { ...(b.ui || {}), ...(a.ui || {}) } };
  }
  function uiSig() { return JSON.stringify([ui.region, ui.mapApp, ui.homeCats, ui.customGroups]); }
  function markDirty() {
    if (applying || !user) return;
    writeSync({ ...readSync(), dirty: true });
    clearTimeout(pushTimer); pushTimer = setTimeout(() => syncNow(), 2000);
  }
  async function pull() {
    const { data, error } = await sb.from('weekend_data').select('data, updated_at').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  }
  async function push(doc) {
    const at = new Date().toISOString();
    const { error } = await sb.from('weekend_data').upsert({ user_id: user.id, data: doc, updated_at: at });
    if (error) throw error;
    return at;
  }
  async function syncNow(manual) {
    if (!sb || !user || sync.busy) return;
    sync.busy = true; sync.err = '';
    if (route() === 'settings') renderSettings();
    try {
      const st = readSync();
      const remote = await pull();
      const local = snapshot();
      const firstHere = st.uid !== user.id;
      let doc = null; // 올릴 내용(null이면 올릴 것 없음)
      if (!remote) doc = local;
      else if (firstHere) { doc = mergeSnap(remote.data || {}, local); applySnapshot(doc); }
      else if (remote.updated_at > (st.at || '')) {
        // 다른 기기에서 바뀜: 이 기기에도 안 올린 변경이 있으면 합치고, 없으면 그대로 받아요.
        if (st.dirty) { doc = mergeSnap(local, remote.data || {}); applySnapshot(doc); } else applySnapshot(remote.data || {});
        if (!st.dirty) writeSync({ uid: user.id, at: remote.updated_at, dirty: false });
      } else if (st.dirty || manual) doc = local;
      if (doc) { const at = await push(doc); writeSync({ uid: user.id, at, dirty: false }); }
      sync.lastAt = new Date().toISOString();
      render();
      if (manual) toast('동기화했어요');
    } catch (e) {
      sync.err = String((e && e.message) || e).slice(0, 120);
      if (manual) toast('동기화하지 못했어요: ' + sync.err);
    } finally { sync.busy = false; if (route() === 'settings') renderSettings(); }
  }
  function loadScript(src) {
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('로그인 도구를 불러오지 못했어요(인터넷 연결 확인)')); document.head.appendChild(s); });
  }
  async function initAuth() {
    if (!SB_URL || !SB_KEY) return;
    const fromLink = /access_token=|error_description=/.test(location.hash);
    // 로그인한 적이 없고 메일 링크로 연 것도 아니면, 설정 화면을 열 때까지 로그인 도구를 받지 않아요.
    if (!fromLink && !localStorage.getItem(SYNC_KEY) && route() !== 'settings' && !initAuth.force) return;
    if (sb) return;
    try {
      await loadScript(SB_LIB);
      sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } });
      sb.auth.onAuthStateChange((ev, session) => {
        const was = user && user.id;
        user = session ? session.user : null;
        if (user && was !== user.id) {
          if (/access_token=/.test(location.hash)) history.replaceState(null, '', location.pathname + '#settings');
          toast(`${user.email}(으)로 로그인했어요`);
          syncNow();
        }
        render();
      });
      const { data } = await sb.auth.getSession();
      user = data.session ? data.session.user : null;
      if (/error_description=/.test(location.hash)) { const m = new URLSearchParams(location.hash.slice(1)).get('error_description'); history.replaceState(null, '', location.pathname + '#settings'); sync.err = m || '로그인 링크가 만료됐어요. 다시 받아 주세요.'; }
      if (user) { if (!readSync().uid) writeSync({ ...readSync() }); syncNow(); }
    } catch (e) { sync.err = String(e.message || e); }
    if (route() === 'settings') renderSettings();
  }
  async function sendLink() {
    const email = $('acEmail').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('이메일 주소를 확인해 주세요'); return; }
    initAuth.force = true; await initAuth();
    if (!sb) { toast(sync.err || '로그인을 쓸 수 없어요'); return; }
    $('acSend').disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    $('acSend').disabled = false;
    if (error) { toast(/rate|seconds/i.test(error.message) ? '메일을 너무 자주 보냈어요. 잠시 뒤 다시 해 주세요.' : '메일을 보내지 못했어요: ' + error.message); return; }
    sync.sent = email; renderSettings();
  }
  async function signOut() {
    if (!await ask('로그아웃할까요?\n이 기기의 즐겨찾기는 그대로 남고, 계정에 저장된 내용도 지워지지 않아요.', '로그아웃')) return;
    await sb.auth.signOut();
    user = null; try { localStorage.removeItem(SYNC_KEY); } catch { /* 선택 */ }
    render(); toast('로그아웃했어요');
  }
  function accountHtml() {
    if (!SB_URL || !SB_KEY) return '<p class="muted">로그인 기능을 준비 중이에요.</p>';
    const when = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    if (user) {
      const st = readSync();
      return `<p><b>📧 ${esc(user.email)}</b></p><p class="muted">${sync.busy ? '동기화하는 중…' : sync.err ? '⚠️ ' + esc(sync.err) : st.at ? `즐겨찾기·제외 목록·설정이 계정에 저장돼요 · 마지막 동기화 ${when(st.at)}` : '동기화 준비 중…'}</p>` +
        '<div class="row wrapline"><button id="acSync">🔄 지금 동기화</button><button class="ghost" id="acOut">로그아웃</button></div>';
    }
    if (sync.sent) return `<p><b>📬 ${esc(sync.sent)}</b>(으)로 로그인 링크를 보냈어요.</p><p class="muted">메일의 링크를 이 기기에서 눌러 주세요. 메일이 안 보이면 스팸함도 확인해 주세요.</p><button class="ghost small" id="acAgain">다른 이메일로</button>`;
    return '<p class="muted">로그인하면 즐겨찾기·제외 목록·설정이 계정에 저장돼서, 휴대폰과 PC에서 같이 쓸 수 있어요. 비밀번호 없이 이메일로 받은 링크를 누르면 돼요.</p>' +
      `<div class="row" style="gap:6px"><input id="acEmail" type="email" inputmode="email" autocomplete="email" placeholder="이메일 주소" aria-label="이메일 주소"><button class="primary" id="acSend">링크 받기</button></div>${sync.err ? `<p class="muted">⚠️ ${esc(sync.err)}</p>` : ''}`;
  }

  // ---------- 이벤트 ----------
  document.addEventListener('click', (e) => {
    const t = e.target;
    const q = (sel) => t.closest(sel);
    let el;
    if ((el = q('[data-close]'))) { el.closest('dialog').close(); return; }
    if (q('[data-open-import]')) { openImport(); return; }
    if (q('#acSend')) { sendLink(); return; }
    if (q('#acSync')) { syncNow(true); return; }
    if (q('#acOut')) { signOut(); return; }
    if (q('#acAgain')) { sync.sent = false; renderSettings(); return; }
    if ((el = q('[data-unsave]'))) {
      e.stopPropagation();
      const id = el.dataset.unsave;
      const dlg = el.closest('dialog');
      unsave(id).then((ok) => {
        if (!ok) return;
        if (dlg && dlg.id === 'detailDlg' && dlg.open) { const p = findPlace(id); if (p) $('detailBody').innerHTML = detailHtml(p); else dlg.close(); }
        render();
      });
      return;
    }
    if ((el = q('[data-save]'))) {
      e.stopPropagation(); saveFromPool(el.dataset.save);
      const dlg = el.closest('dialog');
      if (dlg && dlg.id === 'detailDlg') $('detailBody').innerHTML = detailHtml(findPlace(el.dataset.save) || {});
      if (dlg && dlg.id === 'pickDlg') el.outerHTML = '<span class="tag">즐겨찾기에 저장됨</span>';
      render(); return;
    }
    if ((el = q('[data-edit]'))) { openEdit(el.dataset.edit); return; }
    if ((el = q('[data-detail]'))) {
      if (q('a[target]')) return; // 지도 앱 링크는 그대로 열기
      e.preventDefault(); openDetail(el.dataset.detail); return;
    }
    if ((el = q('[data-hcat]'))) { ui.homeCat = el.dataset.hcat; saveUi(); render(); return; }
    if ((el = q('[data-rcat]'))) { ui.favRecCat = el.dataset.rcat; saveUi(); render(); return; }
    if ((el = q('[data-env]'))) { ui.env = el.dataset.env; saveUi(); render(); return; }
    if ((el = q('[data-fsort], [data-psort], [data-esort], [data-foodsort]'))) {
      const key = el.dataset.fsort ? 'favOrder' : el.dataset.psort ? 'popSort' : el.dataset.foodsort ? 'foodSort' : 'evSort';
      const v = el.dataset.fsort || el.dataset.psort || el.dataset.esort || el.dataset.foodsort;
      if (v === 'near' && !here) {
        if (!navigator.geolocation || !window.isSecureContext) { toast('이 주소에서는 위치를 쓸 수 없어요(https 주소에서 열어 주세요).'); return; }
        locate(() => { ui[key] = 'near'; saveUi(); render(); }); return;
      }
      ui[key] = v; saveUi(); render(); return;
    }
    // 앱 안에서 넘어왔으면 이전 화면으로, 바로 열었으면 인기 화면으로
    if (q('[data-back]')) { if (movedInApp) history.back(); else location.hash = '#popular'; return; }
    if ((el = q('[data-esub]'))) { ui.evSub = el.dataset.esub; saveUi(); render(); return; }
    if ((el = q('[data-evwhen]'))) { ui.evWhen = el.dataset.evwhen; saveUi(); render(); return; }
    if ((el = q('[data-foodsrc]'))) { ui.foodSrc = el.dataset.foodsrc; ui.foodReg = ''; saveUi(); render(); return; }
    if (q('[data-foodkids]')) { ui.foodKids = !ui.foodKids; saveUi(); render(); return; }
    if ((el = q('[data-foodkind]'))) { ui.foodKind = el.dataset.foodkind; saveUi(); render(); return; }
    if ((el = q('[data-foodreg]'))) { ui.foodReg = el.dataset.foodreg; saveUi(); render(); return; }
    if ((el = q('[data-psub]'))) { ui.popSub = el.dataset.psub; saveUi(); render(); return; }
    if ((el = q('[data-mapapp]'))) { ui.mapApp = el.dataset.mapapp; saveUi(); render(); toast(`장소는 ${MAP_APPS[ui.mapApp]}로 열어요`); return; }
    if (q('[data-exclude-shown]')) { excludeShown(); return; }
    if (q('[data-sel-start]')) { selMode = true; picked.clear(); render(); return; }
    if (q('[data-sel-done]')) { selMode = false; picked.clear(); render(); return; }
    if (q('[data-sel-all]')) { const ids = favRows().rows.map((p) => p.id); const all = ids.every((id) => picked.has(id)); ids.forEach((id) => (all ? picked.delete(id) : picked.add(id))); renderSaved(); return; }
    if (q('[data-sel-del]')) { removePicked(); return; }
    if ((el = q('[data-restore]'))) { restoreExcluded(el.dataset.restore); return; }
    if ((el = q('[data-fsrc]'))) { ui.favSrc = el.dataset.fsrc; ui.favCat = ''; ui.favRegion = ''; saveUi(); render(); return; }
    if ((el = q('[data-fcat]'))) { ui.favCat = el.dataset.fcat; ui.favRegion = ''; saveUi(); render(); return; }
    if ((el = q('[data-freg]'))) { ui.favRegion = el.dataset.freg; saveUi(); render(); return; }
    if (q('[data-show-map]')) {
      const title = [ui.favSrc && SRC[ui.favSrc], ui.favCat ? C.label(ui.favCat) : '즐겨찾기 전체', ui.favRegion || '전체 지역'].filter(Boolean).join(' · ');
      showMap(favRows().rows, title); return;
    }
    if ((el = q('[data-list-update]'))) { updateList(el.dataset.listUpdate, el); return; }
    if ((el = q('[data-list-forget]'))) { forgetList(el.dataset.listForget); return; }
    if ((el = q('[data-del-group]'))) { removeGroup(el.dataset.delGroup); return; }
    if ((el = q('[data-goto-cat]'))) { ui.favCat = el.dataset.gotoCat; ui.favRegion = ''; saveUi(); location.hash = '#saved'; return; }
    if (q('[data-goto-saved]')) { $('importDlg').close(); location.hash = '#saved'; render(); return; }
    if ((el = q('[data-pickfrom]'))) { ui.pickFrom = el.dataset.pickfrom; saveUi(); doPick(); return; }
    if ((el = q('[data-widen]'))) {
      const k = el.dataset.widen;
      if (k === 'group') ui.homeCat = ''; if (k === 'favcat') ui.favRecCat = ''; if (k === 'env') ui.env = ''; if (k === 'region') ui.region = 'all';
      saveUi(); if (k === 'region') loadLive(); render();
      if ($('pickDlg').open) doPick();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.detail) openDetail(e.target.dataset.detail);
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'regionPill') { ui.region = t.value; saveUi(); loadLive(); render(); }
    if (t.dataset.hc) {
      const k = t.dataset.hc;
      ui.homeCats = t.checked ? [...new Set([...ui.homeCats, k])] : ui.homeCats.filter((x) => x !== k);
      saveUi();
    }
    if (t.dataset.pv !== undefined) updatePvButton();
    if (t.dataset.pick) { if (t.checked) picked.add(t.dataset.pick); else picked.delete(t.dataset.pick); t.closest('.item').classList.toggle('on', t.checked); selBar(); }
    if (t.id === 'selCat') setPickedCategory(t.value);
  });
  $('search').oninput = renderSaved;
  $('pick').onclick = doPick;
  $('reroll').onclick = doPick;
  $('reshuffle').onclick = () => { order = new Map(); renderHome(); };
  $('pasteGo').onclick = runPaste;
  $('popInfo').onclick = $('setPopInfo').onclick = () => $('popDlg').showModal();
  $('popMore').onclick = () => {
    ui.popSub = { seoul: '서울', gyeonggi: '경기' }[ui.region] || (SUBS.includes(ui.region) ? ui.region : ''); saveUi();
    location.hash = '#popular';
  };
  // 배경(바깥) 누르면 시트 닫기
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
  let movedInApp = false;
  window.addEventListener('hashchange', () => { movedInApp = true; window.scrollTo(0, 0); render(); });

  // ---------- 인기 장소 데이터 ----------
  function liveErrorText(err) {
    const m = String((err && err.message) || err);
    if (/timeout|aborted| 04 |HTTP_ERROR/i.test(m)) return '한국관광공사 서버가 응답하지 않아요. 잠시 뒤 다시 불러와 주세요.';
    if (/ 30 |NOT_REGISTERED/i.test(m)) return '인증키가 아직 등록되지 않았어요(발급 후 1시간 정도 걸려요).';
    if (/ 22 |LIMITED/i.test(m)) return '오늘 호출 한도를 넘었어요. 내일 다시 시도해 주세요.';
    if (DATA && /404/.test(m)) return '이 지역의 인기 장소 데이터가 아직 없어요(매일 아침 자동으로 만들어져요).';
    if (/TOUR_API_KEY|503|404/.test(m)) return '서버에 인증키가 설정되지 않았어요.';
    return m.slice(0, 100);
  }
  function readCache() { try { return JSON.parse(localStorage.getItem(C.LIVE_CACHE_KEY) || 'null'); } catch { return null; } }
  function livePlaces(data) {
    return (data.places || []).filter((p) => p && p.name).map((p, i) => {
      // 앱의 분류 규칙을 먼저 적용해요(시장·몰 등은 '기타'가 되어 나들이 추천에서 빠져요).
      const mine = C.infer(p.name);
      const category = mine !== '기타' ? mine : C.TYPES[p.category] ? p.category : mine;
      return { ...p, id: 'live-' + (p.id || i), origin: 'live', category, env: C.TYPES[category].env || p.env || '' };
    });
  }
  // 인기 탭은 전국 데이터(지역 파일 7개)를 한 번에 받아 '서울·경기 / 그 외 / 전체'로 나눠 보여줘요.
  const AREAS = ['sg', 'incheon', 'gangwon', 'chung', 'jeolla', 'gyeong', 'jeju'];
  let nation = { status: 'idle', byArea: {}, foods: {}, foodNote: {} };
  const foodPlaces = (data, a) => (data.foods || []).filter((p) => p && p.name)
    .map((p, i) => ({ ...p, kind: String(p.kind || '').replace('음식점기타', '음식점'), id: 'live-' + (p.id || 'food' + i), origin: 'live', category: '맛집·카페', env: '실내', area: a }));
  async function loadNation(force) {
    if (nation.status === 'loading' || (nation.status === 'ok' && !force)) return;
    if (API === '' && !DATA) return;
    nation = { ...nation, status: 'loading' };
    await Promise.all(AREAS.map(async (a) => {
      try {
        const res = DATA ? await fetch(`${DATA}/discover-${a}.json`, { cache: force ? 'reload' : 'default', signal: AbortSignal.timeout(20000) })
          : await fetch(`${API}/discover?region=${a}`, { signal: AbortSignal.timeout(45000) });
        const data = res.status === 200 ? await res.json() : null;
        if (data && Array.isArray(data.places)) nation.byArea[a] = livePlaces(data).map((p) => ({ ...p, area: a }));
        if (data) { nation.foods[a] = foodPlaces(data, a); nation.foodNote[a] = data.foodNote || ''; }
      } catch { /* 그 지역만 빠짐 */ }
    }));
    nation.status = 'ok';
    if (['popular', 'food'].includes(route())) render();
  }
  // 행사 모아보기: 전국 행사 파일 하나(data/events.json, 로컬 서버는 /api/events)
  let evData = { status: 'idle', list: [], meta: null };
  async function loadEvents(force) {
    if (evData.status === 'loading' || (evData.status === 'ok' && !force)) return;
    if (API === '' && !DATA) return;
    evData = { ...evData, status: 'loading' };
    try {
      const res = DATA ? await fetch(`${DATA}/events.json`, { cache: force ? 'reload' : 'default', signal: AbortSignal.timeout(20000) })
        : await fetch(`${API}/events${force ? '?refresh=1' : ''}`, { signal: AbortSignal.timeout(45000) });
      const data = await res.json().catch(() => null);
      if (res.status === 202) {
        evData = { status: 'pending', list: [], meta: null };
        clearTimeout(loadEvents.retry); loadEvents.retry = setTimeout(() => loadEvents(), 60000);
      } else {
        if (!res.ok || !data || !Array.isArray(data.events)) throw new Error((data && data.error) || `HTTP ${res.status}`);
        evData = { status: 'ok', list: [], meta: data };
        evData.list = data.events.map(evPlace);
      }
    } catch (err) { evData = { status: 'error', list: [], meta: null, error: liveErrorText(err) }; }
    if (['popular', 'events'].includes(route())) render();
  }
  function useLive(data, stale) {
    live = {
      status: 'ok', stale,
      meta: { fetchedAt: data.fetchedAt, popularityNote: data.popularityNote },
      places: livePlaces(data),
    };
  }
  async function loadLive(force) {
    const region = ui.region;
    const cache = readCache();
    if (!force && cache && cache.region === region && Date.now() - new Date(cache.data.fetchedAt).getTime() < LIVE_TTL) { useLive(cache.data, false); render(); return; }
    if ((API === '' && !DATA) || CONFIG.disableLive) { live = { status: 'off', places: [], meta: null }; render(); return; }
    live = { status: 'loading', places: [], meta: null }; render();
    try {
      const res = DATA
        ? await fetch(`${DATA}/discover-${dataRegion(region)}.json`, { cache: force ? 'reload' : 'default', signal: AbortSignal.timeout(20000) })
        : await fetch(`${API}/discover?region=${encodeURIComponent(region)}${force === true ? '&refresh=1' : ''}`, { signal: AbortSignal.timeout(45000) });
      const data = await res.json().catch(() => null);
      if (res.status === 202 && data && data.pending) {
        // 서버가 처음 데이터를 만드는 중(공공데이터 응답이 느려 몇 분 걸려요) → 1분 뒤 다시 확인
        if (region !== ui.region) return;
        if (cache && cache.region === region) useLive(cache.data, true);
        else live = { status: 'pending', places: [], meta: null };
        clearTimeout(loadLive.retry); loadLive.retry = setTimeout(() => loadLive('retry'), 60000);
        render(); return;
      }
      if (!res.ok || !data || data.error) throw new Error((data && data.error) || `HTTP ${res.status}`);
      if (region !== ui.region) return;
      useLive(data, false);
      try { localStorage.setItem(C.LIVE_CACHE_KEY, JSON.stringify({ region, data })); } catch { /* 선택 */ }
    } catch (err) {
      if (region !== ui.region) return;
      if (cache && cache.region === region) useLive(cache.data, true);
      else live = { status: 'error', places: [], meta: null, error: liveErrorText(err) };
    }
    render();
  }

  // ---------- 공유받기(안드로이드 설치 앱) ----------
  const params = new URLSearchParams(location.search);
  const shared = ['title', 'text', 'url'].map((k) => params.get(k)).filter(Boolean);
  if (shared.length) {
    history.replaceState(null, '', location.pathname + '#saved');
    openImport([...new Set(shared)].join('\n'));
    runPaste();
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 기능만 빠짐 */ });
  }

  // 다른 기기에서 바꾼 내용: 앱으로 돌아올 때 받아와요.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && user) syncNow(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'acEmail') sendLink(); });

  render();
  loadLive();
  locate();
  initAuth();
})();
