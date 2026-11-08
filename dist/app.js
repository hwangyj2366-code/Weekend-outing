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
  const loaded = C.loadPlaces(localStorage);
  let saved = loaded.places;
  if (loaded.migrated) persist(saved, true);

  const defaults = { region: 'sg', homeGroup: '', env: '', favGroup: 'kids', favCat: '', favRegion: '', favSort: 'name', pickFrom: 'all', homeGroups: ['kids', 'camp', 'food'] };
  let ui = { ...defaults };
  try {
    const s = JSON.parse(localStorage.getItem(C.SETTINGS_KEY) || '{}');
    ui = { ...defaults, ...s, homeGroup: s.homeGroup ?? s.category ?? '' };
    if (!C.GROUPS.some((g) => g.id === ui.homeGroup)) ui.homeGroup = '';
    if (!Array.isArray(ui.homeGroups)) ui.homeGroups = defaults.homeGroups;
    ui.homeGroups = ui.homeGroups.filter((id) => C.GROUPS.some((g) => g.id === id)); // 없어진 '여행지' 묶음 정리
  } catch { /* 기본값 */ }
  let live = { status: 'loading', places: [], meta: null };
  let order = new Map(); // 홈 즐겨찾기 추천 섞기 순서
  let lastPickId = null;
  let preview = []; // 가져오기 미리보기 항목

  function persist(next, quiet) {
    try { C.savePlaces(localStorage, next); saved = next; return true; } catch {
      if (!quiet) alert('브라우저에 저장할 수 없어요. 저장 공간이나 사생활 보호 모드를 확인해 주세요.');
      return false;
    }
  }
  function saveUi() { try { localStorage.setItem(C.SETTINGS_KEY, JSON.stringify(ui)); } catch { /* 선택 */ } }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- 공통 조각 ----------
  const T = (p) => C.TYPES[p.category] || C.TYPES['기타'];
  function mapHref(p) {
    const url = C.validUrl(p.url);
    if (url) return { href: url, label: C.mapSource(url) || '지도' };
    const term = encodeURIComponent([p.name, p.region].filter(Boolean).join(' '));
    return { href: `https://map.naver.com/p/search/${term}`, label: '네이버지도', alt: `https://www.google.com/maps/search/?api=1&query=${term}` };
  }
  function mapButtons(p, cls = '') {
    const m = mapHref(p);
    return `<a class="link primary ${cls}" target="_blank" rel="noopener noreferrer" href="${esc(m.href)}">🗺 ${esc(m.label)}에서 열기</a>` +
      (m.alt ? `<a class="link ${cls}" target="_blank" rel="noopener noreferrer" href="${esc(m.alt)}">구글지도</a>` : '');
  }
  function art(p, extra = '') {
    const t = T(p);
    const badge = p.origin === 'seed' ? '기본 추천' : p.popularity ? (p.popularity.kind === 'festival' ? '이번 주말' : '인기') : '';
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
  const metaLine = (p, unknown = '') => [distText(p), C.label(p.category), p.env, p.region || unknown].filter(Boolean).map(esc).join(' · ');

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

  function mini(p) {
    const heart = p.origin && !isSaved(p) ? `<button class="heart" data-save="${esc(p.id)}" aria-label="${esc(p.name)} 저장">♡</button>` : '';
    return `<article class="mini" data-detail="${esc(p.id)}" tabindex="0" role="button">${art(p, heart)}<div class="body">` +
      `<span class="muted">${metaLine(p)}</span><h3>${esc(p.name)}</h3>` +
      (p.popularity ? `<span class="pop">🔥 ${esc(p.popularity.label)}</span>` : '') + '</div></article>';
  }
  function detailHtml(p) {
    const pop = p.popularity ? `<div class="popbox">🔥 <b>${esc(p.popularity.label)}</b><div class="muted">${esc(p.popularity.source)} · 기준 ${esc(p.popularity.basis)}</div></div>` : '';
    const h = p.hours || {};
    const rows = [['이용시간', h.usetime], ['쉬는 날', h.restdate], ['요금', h.usefee], ['유모차', h.babycarriage], ['주차', h.parking], ['예약', h.reservation], ['문의', h.infocenter]].filter(([, v]) => v);
    const hours = rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><p class="muted">출처: ${esc(h.source || '')}${h.updated ? ` · 정보 수정일 ${esc(h.updated)}` : ''}</p>` : '';
    const note = p.note || (p.origin === 'seed' ? '' : '');
    const savedHere = isSaved(p);
    const own = saved.find((s) => s.id === p.id);
    const actions = own ? `<button data-edit="${esc(own.id)}">✏️ 분류·편집</button>`
      : savedHere ? '<span class="tag">즐겨찾기에 있음</span>' : `<button data-save="${esc(p.id)}">♡ 즐겨찾기 저장</button>`;
    const km = C.distanceKm(here, p);
    return `${art(p)}<div class="muted" style="margin-top:12px">${metaLine(p, '지역 미확인')}${km != null ? ' <span class="muted">(현재 위치에서 직선거리)</span>' : ''}</div>` +
      `<h2>${esc(p.name)}</h2>${note ? `<p>${esc(note)}</p>` : ''}${pop}${hours}` +
      `<p class="muted">방문 전 운영시간·휴무·예약을 지도나 공식 홈페이지에서 꼭 확인해 주세요.</p>` +
      `<div class="row wrapline">${mapButtons(p)}${actions}</div>`;
  }

  // ---------- 데이터 묶음 ----------
  const popularPool = () => C.discoverPool(live.places, C.SEED, saved);
  function homeFilter(extra = {}) {
    return { group: ui.homeGroup, env: ui.env, region: ui.region, ...extra };
  }
  function findPlace(id) {
    return saved.find((p) => p.id === id) || live.places.find((p) => p.id === id) || C.SEED.find((p) => p.id === id);
  }

  // ---------- 화면: 공통 ----------
  function route() { const r = location.hash.replace('#', ''); return ['home', 'saved', 'settings'].includes(r) ? r : 'home'; }
  function render() {
    const r = route();
    document.querySelectorAll('[data-page]').forEach((el) => { el.hidden = el.dataset.page !== r; });
    document.querySelectorAll('[data-tab]').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === r ? 'page' : 'false'));
    $('tabCount').hidden = !saved.length; $('tabCount').textContent = saved.length;
    $('title').textContent = r === 'home' ? '🌿 주말에 어디가지?' : r === 'saved' ? `⭐ 즐겨찾기 ${saved.length}곳` : '⚙️ 설정';
    $('topAction').innerHTML = r === 'home'
      ? `<select id="regionPill" class="pill" aria-label="지역">${C.REGIONS.map((x) => `<option value="${x.id}" ${x.id === ui.region ? 'selected' : ''}>📍 ${esc(x.label)}</option>`).join('')}</select>`
      : r === 'saved' ? '<button class="primary" data-open-import>＋ 가져오기</button>' : '';
    if (r === 'home') renderHome(); else if (r === 'saved') renderSaved(); else renderSettings();
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
    const groups = C.GROUPS.filter((g) => g.outing || ui.homeGroups.includes(g.id));
    $('homeGroups').innerHTML = `<button data-hgroup="" class="${ui.homeGroup ? '' : 'active'}">전체</button>` +
      groups.map((g) => `<button data-hgroup="${g.id}" class="${ui.homeGroup === g.id ? 'active' : ''}">${g.icon} ${esc(g.short)}</button>`).join('');
    $('homeEnv').innerHTML = [['', '실내·야외 모두'], ['실내', '☔ 실내'], ['야외', '☀️ 야외']]
      .map(([v, t]) => `<button data-env="${v}" class="${ui.env === v ? 'active' : ''}">${t}</button>`).join('');

    // ① 인기
    const pop = C.filterPlaces(popularPool(), homeFilter({ outingOnly: true }))
      .sort((a, b) => ((b.popularity && b.popularity.score) || 0) - ((a.popularity && a.popularity.score) || 0));
    const s = liveStatus();
    $('popStatus').textContent = s.text; $('popStatus').classList.toggle('off', s.off);
    $('popList').innerHTML = pop.length ? pop.slice(0, 30).map(mini).join('')
      : `<div class="empty" style="flex:1"><p>이 조건에 맞는 인기 장소가 없어요.</p>${widenButtons()}</div>`;

    // ② 즐겨찾기에서
    const regionOk = C.filterPlaces(saved, homeFilter({ group: '', allowUnknownRegion: true }));
    const showGroups = (ui.homeGroup ? [C.groupInfo(ui.homeGroup)] : C.GROUPS.filter((g) => ui.homeGroups.includes(g.id)));
    if (!saved.length) {
      $('favRecs').innerHTML = `<div class="empty"><p>네이버·구글지도에 저장해 둔 곳을 가져오면<br>분류별로 골라서 추천해 드려요.</p><button class="primary big" data-open-import>＋ 지도 즐겨찾기 가져오기</button></div>`;
      return;
    }
    const html = showGroups.map((g) => {
      const rows = regionOk.filter((p) => C.groupOf(p.category) === g.id);
      if (!rows.length) return '';
      rows.forEach((p) => { if (!order.has(p.id)) order.set(p.id, Math.random()); });
      const top = [...rows].sort((a, b) => order.get(a.id) - order.get(b.id)).slice(0, 6);
      return `<div class="group-head"><h3>${g.icon} ${esc(g.label)} <span class="muted">${rows.length}곳</span></h3><button class="ghost small" data-goto-group="${g.id}">전체 보기 ›</button></div>` +
        `<div class="scroller">${top.map(mini).join('')}</div>`;
    }).join('');
    $('favRecs').innerHTML = html || `<div class="empty"><p>지금 조건(${esc(condText())})에 맞는 즐겨찾기가 없어요.</p>${widenButtons()}</div>`;
  }
  function widenButtons() {
    const b = [];
    if (ui.homeGroup) b.push('<button data-widen="group">분류 전체</button>');
    if (ui.env) b.push('<button data-widen="env">실내·야외 모두</button>');
    if (ui.region !== 'all') b.push('<button data-widen="region">전국으로 넓히기</button>');
    return `<div class="row wrapline" style="justify-content:center">${b.join('')}</div>`;
  }
  function condText() {
    const r = C.REGIONS.find((x) => x.id === ui.region);
    return [r && r.label, ui.homeGroup ? C.groupInfo(ui.homeGroup).label : '나들이 전체', ui.env || '실내·야외 모두'].join(' · ');
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
  function itemRow(p) {
    const t = T(p); const m = mapHref(p);
    return `<div class="item"><div class="ico" style="background:${t.bg}" aria-hidden="true">${t.icon}</div>` +
      `<div class="txt" data-detail="${esc(p.id)}" role="button" tabindex="0"><b>${esc(p.name)}</b><span class="muted">${metaLine(p, '지역 미확인')}</span></div>` +
      `<div class="acts"><a class="link" target="_blank" rel="noopener noreferrer" href="${esc(m.href)}" aria-label="${esc(p.name)} 지도 열기">🗺</a><button data-edit="${esc(p.id)}" aria-label="${esc(p.name)} 편집">✏️</button></div></div>`;
  }
  const UNKNOWN = '지역 미확인';
  const regionKey = (p) => C.regionToken(p) || UNKNOWN;
  const countBy = (rows, key) => rows.reduce((m, p) => { const k = key(p); m[k] = (m[k] || 0) + 1; return m; }, {});
  // 즐겨찾기: 큰 분류(필수) → 세부 분류(전체 포함) → 지역(전체 포함)
  function favRows() {
    const inGroup = saved.filter((p) => C.groupOf(p.category) === ui.favGroup);
    const inCat = ui.favCat ? inGroup.filter((p) => p.category === ui.favCat) : inGroup;
    const inRegion = ui.favRegion ? inCat.filter((p) => regionKey(p) === ui.favRegion) : inCat;
    return { inGroup, inCat, rows: C.filterPlaces(inRegion, { q: $('search').value }) };
  }
  function renderSaved() {
    const groupCounts = countBy(saved, (p) => C.groupOf(p.category));
    const groups = C.GROUPS.filter((g) => groupCounts[g.id]);
    if (!groups.some((g) => g.id === ui.favGroup)) { ui.favGroup = (groups[0] || C.GROUPS[0]).id; ui.favCat = ''; ui.favRegion = ''; }
    $('favGroups').innerHTML = groups.map((g) => `<button data-fgroup="${g.id}" class="${ui.favGroup === g.id ? 'active' : ''}">${g.icon} ${esc(g.short)} ${groupCounts[g.id]}</button>`).join('');
    if (!saved.length) {
      $('favSub').innerHTML = ''; $('favRegion').innerHTML = ''; $('favMap').hidden = true;
      $('favList').innerHTML = `<div class="empty" style="margin-top:14px"><p>아직 저장한 곳이 없어요.<br>네이버·구글지도 리스트 링크만 붙이면 한 번에 정리해 드려요.</p><button class="primary big" data-open-import>＋ 지도 즐겨찾기 가져오기</button></div>`;
      return;
    }
    const { inGroup, inCat, rows } = favRows();
    const catCounts = countBy(inGroup, (p) => p.category);
    const cats = Object.keys(C.TYPES).filter((k) => catCounts[k]);
    if (ui.favCat && !catCounts[ui.favCat]) ui.favCat = '';
    $('favSub').innerHTML = cats.length > 1
      ? `<button data-fcat="" class="${ui.favCat ? '' : 'active'}">전체 ${inGroup.length}</button>` +
        cats.map((k) => `<button data-fcat="${esc(k)}" class="${ui.favCat === k ? 'active' : ''}">${C.TYPES[k].icon} ${esc(C.label(k))} ${catCounts[k]}</button>`).join('')
      : '';
    const regCounts = countBy(inCat, regionKey);
    const regs = Object.keys(regCounts).sort((a, b) => (a === UNKNOWN) - (b === UNKNOWN) || regCounts[b] - regCounts[a]);
    if (ui.favRegion && !regCounts[ui.favRegion]) ui.favRegion = '';
    $('favRegion').innerHTML = `<button data-freg="" class="${ui.favRegion ? '' : 'active'}">📍 전체 ${inCat.length}</button>` +
      regs.map((r) => `<button data-freg="${esc(r)}" class="${ui.favRegion === r ? 'active' : ''}">${esc(r)} ${regCounts[r]}</button>`).join('');
    const located = rows.filter((p) => p.lat != null).length;
    $('favMap').hidden = false;
    const near = ui.favSort === 'near' && here;
    $('favMap').innerHTML = `<span class="row"><span class="muted">${rows.length}곳</span>` +
      `<button class="small ${near ? 'active' : ''}" data-fsort="${near ? 'name' : 'near'}">${near ? '📍 가까운 순' : '가나다순'}</button></span>` +
      `<button class="primary small" data-show-map ${rows.length ? '' : 'disabled'}>🗺 지도에서 보기${located < rows.length ? ` (${located}/${rows.length})` : ''}</button>`;
    const sortRows = (list) => (near ? C.byDistance(list, here) : [...list].sort((a, b) => a.name.localeCompare(b.name, 'ko')));
    const html = ui.favCat || cats.length < 2 || near
      ? `<div class="list">${sortRows(rows).map(itemRow).join('')}</div>`
      : cats.map((k) => {
        const list = sortRows(rows.filter((p) => p.category === k));
        return list.length ? `<div class="group-head"><h3>${C.TYPES[k].icon} ${esc(C.label(k))} <span class="muted">${list.length}</span></h3></div><div class="list">${list.map(itemRow).join('')}</div>` : '';
      }).join('');
    $('favList').innerHTML = rows.length ? html : '<div class="empty" style="margin-top:14px"><p>조건에 맞는 곳이 없어요.</p></div>';
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
    $('setGroups').innerHTML = C.GROUPS.map((g) => `<label class="row"><input type="checkbox" data-hg="${g.id}" ${ui.homeGroups.includes(g.id) ? 'checked' : ''}> ${g.icon} ${esc(g.label)}</label>`).join('');
    const s = liveStatus();
    $('setLive').textContent = live.status === 'ok' ? `연결됨 — ${s.text}` : live.status === 'loading' ? '불러오는 중…' : `연결 안 됨 — 기본 추천만 보여요.${live.error ? ` (${live.error})` : ''}`;
    const lists = readLists();
    $('setLists').innerHTML = lists.length ? lists.map((l) => `<div class="prow"><div class="txt"><b>${l.provider === 'naver' ? '🟢' : '🔵'} ${esc(l.name)}</b>` +
      `<span class="muted">${l.count}곳 · ${new Date(l.updatedAt).toLocaleDateString('ko-KR')} 업데이트</span></div>` +
      `<button class="small" data-list-update="${esc(l.url)}">업데이트</button><button class="small ghost" data-list-forget="${esc(l.url)}" aria-label="${esc(l.name)} 잊기">✕</button></div>`).join('')
      : '<p class="muted">리스트 링크로 가져오면 여기에 기억해 두고, 다음부터는 [업데이트] 한 번으로 새로 추가한 곳만 가져와요.</p>';
    $('setHere').textContent = hereStatus === 'insecure' ? '거리 표시: 이 주소(http)에서는 위치를 쓸 수 없어요. https 주소로 배포하면 자동으로 보여요.'
      : hereStatus === 'denied' ? '거리 표시: 위치 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 위치를 허용해 주세요.'
      : here ? `거리 표시: 현재 위치 기준 직선거리 (${new Date(here.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })} 위치)` : '거리 표시: 위치를 확인하는 중이에요.';
    $('setData').textContent = `즐겨찾기 ${saved.length}곳이 이 기기 브라우저에 저장돼 있어요. 휴대폰을 바꾸거나 다른 기기에서 쓰려면 백업 파일을 저장해 옮겨 주세요.`;
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
  $('eCategory').innerHTML = C.GROUPS.map((g) => `<optgroup label="${g.icon} ${esc(g.label)}">${Object.keys(C.TYPES).filter((k) => C.TYPES[k].group === g.id).map((k) => `<option value="${esc(k)}">${C.TYPES[k].icon} ${esc(C.label(k))}</option>`).join('')}</optgroup>`).join('');
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
  $('eDelete').onclick = () => {
    const p = saved.find((x) => x.id === editingId);
    if (!p || !confirm(`‘${p.name}’을(를) 즐겨찾기에서 삭제할까요?`)) return;
    if (persist(saved.filter((x) => x.id !== editingId))) { $('editDlg').close(); render(); toast('삭제했어요'); }
  };

  // ---------- 한 곳 골라줘 ----------
  function pickPool() {
    const f = homeFilter({ outingOnly: true, allowUnknownRegion: true });
    const mine = ui.pickFrom === 'new' ? [] : C.filterPlaces(saved, f);
    const fresh = ui.pickFrom === 'mine' ? [] : C.filterPlaces(popularPool(), f);
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
      : `<div class="empty"><p>지금 조건에 맞는 후보가 없어요.</p><p class="muted">${ui.pickFrom === 'mine' && !saved.length ? '즐겨찾기가 비어 있어요. 먼저 지도 즐겨찾기를 가져오거나 ‘전체’에서 골라 보세요.' : '분류·실내야외·지역 조건을 넓혀 보세요.'}</p>${widenButtons()}</div>`;
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
  function writeLists(v) { try { localStorage.setItem(LISTS_KEY, JSON.stringify(v)); } catch { /* 선택 */ } }
  function rememberList(url, list) {
    const rest = readLists().filter((x) => x.url !== url && !(x.provider === list.provider && x.name === list.listName));
    writeLists([...rest, { url, provider: list.provider, name: list.listName, count: list.places.length, updatedAt: new Date().toISOString() }]);
  }
  function forgetList(url) {
    if (!confirm('이 리스트 링크를 잊을까요? 이미 저장한 장소는 그대로 남아요.')) return;
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
    preview = C.previewImport(saved, candidates);
    const n = preview.filter((x) => x.status === 'new').length;
    const d = preview.filter((x) => x.status === 'dup').length;
    const e = preview.filter((x) => x.status === 'error');
    if (!n && !d) { showReport({ added: [], duplicates: [], warnings: [], errors: e, located: [] }, `${from} 결과`); return; }
    if (!n) { // 새 장소가 없으면 미리보기 없이 위치 정보만 채우고 결과를 보여줘요
      const r = saveCandidates(preview.filter((x) => x.status === 'dup').map((x) => x.place));
      if (r) { r.errors.push(...e); showReport(r, `${from}: 새로 추가된 곳이 없어요`); render(); }
      return;
    }
    $('pvSummary').innerHTML = `불러온 장소 <b>${n + d}곳</b> — 새로 ${n}곳, 이미 저장됨 ${d}곳${e.length ? `, 오류 ${e.length}건` : ''}. 분류를 확인하고 저장할 곳을 고르세요.`;
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
  $('setReload').onclick = () => { try { localStorage.removeItem(C.LIVE_CACHE_KEY); } catch { /* */ } loadLive(true); };
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
  $('wipe').onclick = () => {
    if (!saved.length || !confirm(`즐겨찾기 ${saved.length}곳을 모두 지울까요? 되돌릴 수 없어요. (먼저 백업 파일을 저장해 두는 걸 권해요)`)) return;
    if (persist([])) { render(); toast('모두 지웠어요'); }
  };

  // ---------- 이벤트 ----------
  document.addEventListener('click', (e) => {
    const t = e.target;
    const q = (sel) => t.closest(sel);
    let el;
    if ((el = q('[data-close]'))) { el.closest('dialog').close(); return; }
    if (q('[data-open-import]')) { openImport(); return; }
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
    if ((el = q('[data-hgroup]'))) { ui.homeGroup = el.dataset.hgroup; saveUi(); render(); return; }
    if ((el = q('[data-env]'))) { ui.env = el.dataset.env; saveUi(); render(); return; }
    if ((el = q('[data-fgroup]'))) { ui.favGroup = el.dataset.fgroup; ui.favCat = ''; ui.favRegion = ''; saveUi(); render(); return; }
    if ((el = q('[data-fsort]'))) {
      const v = el.dataset.fsort;
      if (v === 'near' && !here) { locate(() => { ui.favSort = 'near'; saveUi(); }); return; }
      ui.favSort = v; saveUi(); render(); return;
    }
    if ((el = q('[data-fcat]'))) { ui.favCat = el.dataset.fcat; ui.favRegion = ''; saveUi(); render(); return; }
    if ((el = q('[data-freg]'))) { ui.favRegion = el.dataset.freg; saveUi(); render(); return; }
    if (q('[data-show-map]')) {
      const title = [C.groupInfo(ui.favGroup).label, ui.favCat && C.label(ui.favCat), ui.favRegion || '전체 지역'].filter(Boolean).join(' · ');
      showMap(favRows().rows, title); return;
    }
    if ((el = q('[data-list-update]'))) { updateList(el.dataset.listUpdate, el); return; }
    if ((el = q('[data-list-forget]'))) { forgetList(el.dataset.listForget); return; }
    if ((el = q('[data-goto-group]'))) { ui.favGroup = el.dataset.gotoGroup; ui.favCat = ''; ui.favRegion = ''; saveUi(); location.hash = '#saved'; return; }
    if (q('[data-goto-saved]')) { $('importDlg').close(); location.hash = '#saved'; render(); return; }
    if ((el = q('[data-pickfrom]'))) { ui.pickFrom = el.dataset.pickfrom; saveUi(); doPick(); return; }
    if ((el = q('[data-widen]'))) {
      const k = el.dataset.widen;
      if (k === 'group') ui.homeGroup = ''; if (k === 'env') ui.env = ''; if (k === 'region') ui.region = 'all';
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
    if (t.dataset.hg) {
      const id = t.dataset.hg;
      ui.homeGroups = t.checked ? [...new Set([...ui.homeGroups, id])] : ui.homeGroups.filter((x) => x !== id);
      saveUi();
    }
    if (t.dataset.pv !== undefined) updatePvButton();
  });
  $('search').oninput = renderSaved;
  $('pick').onclick = doPick;
  $('reroll').onclick = doPick;
  $('reshuffle').onclick = () => { order = new Map(); renderHome(); };
  $('pasteGo').onclick = runPaste;
  $('popInfo').onclick = $('setPopInfo').onclick = () => $('popDlg').showModal();
  // 배경(바깥) 누르면 시트 닫기
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

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
  function useLive(data, stale) {
    live = {
      status: 'ok', stale,
      meta: { fetchedAt: data.fetchedAt, popularityNote: data.popularityNote },
      places: (data.places || []).filter((p) => p && p.name).map((p, i) => {
        // 앱의 분류 규칙을 먼저 적용해요(시장·몰 등은 '기타'가 되어 나들이 추천에서 빠져요).
        const mine = C.infer(p.name);
        const category = mine !== '기타' ? mine : C.TYPES[p.category] ? p.category : mine;
        return { ...p, id: 'live-' + (p.id || i), origin: 'live', category, env: C.TYPES[category].env || p.env || '' };
      }),
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

  render();
  loadLive();
  locate();
})();
