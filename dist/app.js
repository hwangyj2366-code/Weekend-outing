// 주말에 어디가지? — 화면 동작 (홈 / 즐겨찾기 / 설정)
(function () {
  'use strict';
  const C = window.WeekendCore;
  const CONFIG = window.WEEKEND_CONFIG || {};
  const API = String(CONFIG.apiBase ?? 'api').replace(/\/+$/, '');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LIVE_TTL = 12 * 60 * 60 * 1000;

  // ---------- 상태 ----------
  const loaded = C.loadPlaces(localStorage);
  let saved = loaded.places;
  if (loaded.migrated) persist(saved, true);

  const defaults = { region: 'sg', homeGroup: '', env: '', favGroup: '', pickFrom: 'all', homeGroups: ['kids', 'camp', 'trip', 'food'] };
  let ui = { ...defaults };
  try {
    const s = JSON.parse(localStorage.getItem(C.SETTINGS_KEY) || '{}');
    ui = { ...defaults, ...s, homeGroup: s.homeGroup ?? s.category ?? '' };
    if (!C.GROUPS.some((g) => g.id === ui.homeGroup)) ui.homeGroup = '';
    if (!Array.isArray(ui.homeGroups)) ui.homeGroups = defaults.homeGroups;
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
    const badge = p.origin === 'seed' ? '기본 추천' : p.popularity ? (p.popularity.kind === 'festival' ? '이번 주말' : '인기') : p.list || '';
    return `<div class="art" style="background:${t.bg}">${t.icon}${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}` +
      (badge ? `<span class="badge">${esc(badge)}</span>` : '') + extra + '</div>';
  }
  const metaLine = (p, unknown = '') => [C.label(p.category), p.env, p.region || unknown].filter(Boolean).map(esc).join(' · ');
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
    const rows = [['이용시간', h.usetime], ['쉬는 날', h.restdate], ['예약', h.reservation], ['문의', h.infocenter]].filter(([, v]) => v);
    const hours = rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><p class="muted">출처: ${esc(h.source || '')}${h.updated ? ` · 정보 수정일 ${esc(h.updated)}` : ''}</p>` : '';
    const note = p.note || (p.origin === 'seed' ? '' : '');
    const savedHere = isSaved(p);
    const own = saved.find((s) => s.id === p.id);
    const actions = own ? `<button data-edit="${esc(own.id)}">✏️ 분류·편집</button>`
      : savedHere ? '<span class="tag">즐겨찾기에 있음</span>' : `<button data-save="${esc(p.id)}">♡ 즐겨찾기 저장</button>`;
    return `${art(p)}<div class="muted" style="margin-top:12px">${metaLine(p, '지역 미확인')}${p.list ? ' · ' + esc(p.list) : ''}</div>` +
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
      `<div class="txt" data-detail="${esc(p.id)}" role="button" tabindex="0"><b>${esc(p.name)}</b><span class="muted">${metaLine(p, '지역 미확인')}${p.list ? ' · ' + esc(p.list) : ''}</span></div>` +
      `<div class="acts"><a class="link" target="_blank" rel="noopener noreferrer" href="${esc(m.href)}" aria-label="${esc(p.name)} 지도 열기">🗺</a><button data-edit="${esc(p.id)}" aria-label="${esc(p.name)} 편집">✏️</button></div></div>`;
  }
  function renderSaved() {
    const q = $('search').value;
    const counts = Object.fromEntries(C.GROUPS.map((g) => [g.id, saved.filter((p) => C.groupOf(p.category) === g.id).length]));
    $('favGroups').innerHTML = `<button data-fgroup="" class="${ui.favGroup ? '' : 'active'}">전체 ${saved.length}</button>` +
      C.GROUPS.filter((g) => counts[g.id] || ui.favGroup === g.id).map((g) => `<button data-fgroup="${g.id}" class="${ui.favGroup === g.id ? 'active' : ''}">${g.icon} ${esc(g.short)} ${counts[g.id]}</button>`).join('');
    if (!saved.length) {
      $('favList').innerHTML = `<div class="empty" style="margin-top:14px"><p>아직 저장한 곳이 없어요.<br>네이버·구글지도 리스트 링크만 붙이면 한 번에 정리해 드려요.</p><button class="primary big" data-open-import>＋ 지도 즐겨찾기 가져오기</button></div>`;
      return;
    }
    const rows = C.filterPlaces(saved, { q, group: ui.favGroup });
    const groups = ui.favGroup ? [C.groupInfo(ui.favGroup)] : C.GROUPS;
    const html = groups.map((g) => {
      const list = rows.filter((p) => C.groupOf(p.category) === g.id).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      if (!list.length) return '';
      return `<div class="group-head"><h3>${g.icon} ${esc(g.label)} <span class="muted">${list.length}</span></h3></div><div class="list">${list.map(itemRow).join('')}</div>`;
    }).join('');
    $('favList').innerHTML = html || '<div class="empty" style="margin-top:14px"><p>검색 결과가 없어요.</p></div>';
  }

  // ---------- 화면: 설정 ----------
  function renderSettings() {
    $('setRegion').innerHTML = C.REGIONS.map((x) => `<option value="${x.id}" ${x.id === ui.region ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
    $('setGroups').innerHTML = C.GROUPS.map((g) => `<label class="row"><input type="checkbox" data-hg="${g.id}" ${ui.homeGroups.includes(g.id) ? 'checked' : ''}> ${g.icon} ${esc(g.label)}</label>`).join('');
    const s = liveStatus();
    $('setLive').textContent = live.status === 'ok' ? `연결됨 — ${s.text}` : live.status === 'loading' ? '불러오는 중…' : `연결 안 됨 — 기본 추천만 보여요.${live.error ? ` (${live.error})` : ''}`;
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
      const np = C.makePlace({ ...p, name: $('eName').value, category: $('eCategory').value, region: $('eRegion').value, url: raw, note: $('eNote').value });
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
    const res = await fetch(`${API}/import-list?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(25000) });
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
          list.places.forEach((p) => candidates.push({ ...p, list: list.listName, source: list.provider + '-list' }));
          if (!list.places.length) candidates.push({ error: `${list.listName}: 장소가 없어요` });
        } catch (e) { candidates.push({ error: e.message }); }
      }
      if (!candidates.length) candidates.push({ error: '붙여 넣은 내용에서 장소를 찾지 못했어요.' });
      showPreview(candidates, '붙여넣기');
    } finally { btn.disabled = false; btn.textContent = '불러오기'; }
  }
  function showPreview(candidates, from) {
    preview = C.previewImport(saved, candidates);
    const n = preview.filter((x) => x.status === 'new').length;
    const d = preview.filter((x) => x.status === 'dup').length;
    const e = preview.filter((x) => x.status === 'error');
    if (!n && !d) { showReport({ added: [], duplicates: [], warnings: [], errors: e }, `${from} 결과`); return; }
    $('pvSummary').innerHTML = `불러온 장소 <b>${n + d}곳</b> — 새로 ${n}곳, 이미 저장됨 ${d}곳${e.length ? `, 오류 ${e.length}건` : ''}. 분류를 확인하고 저장할 곳을 고르세요.`;
    const catOpts = (sel) => Object.keys(C.TYPES).map((k) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${C.TYPES[k].icon} ${esc(C.label(k))}</option>`).join('');
    $('pvList').innerHTML = preview.map((x) => x.status === 'error'
      ? `<div class="prow"><span class="tag err">오류</span><div class="txt muted">${esc((x.file ? x.file + ' ' : '') + (x.line ? x.line + '번째 줄: ' : '') + x.error)}</div></div>`
      : `<label class="prow"><input type="checkbox" data-pv="${x.key}" ${x.status === 'new' ? 'checked' : 'disabled'}>` +
        `<div class="txt"><b>${esc(x.place.name)}</b><span class="muted">${esc([x.place.region, x.place.list].filter(Boolean).join(' · ') || '지역 미확인')}</span>` +
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
      return { ...x.place, category: cat, env: cat !== x.place.category ? '' : x.place.env };
    });
    const r = saveCandidates(items);
    if (!r) return;
    r.duplicates.push(...preview.filter((x) => x.status === 'dup').map((x) => x.place.name));
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
    if ((el = q('[data-detail]'))) { if (!q('a')) openDetail(el.dataset.detail); return; }
    if ((el = q('[data-hgroup]'))) { ui.homeGroup = el.dataset.hgroup; saveUi(); render(); return; }
    if ((el = q('[data-env]'))) { ui.env = el.dataset.env; saveUi(); render(); return; }
    if ((el = q('[data-fgroup]'))) { ui.favGroup = el.dataset.fgroup; saveUi(); render(); return; }
    if ((el = q('[data-goto-group]'))) { ui.favGroup = el.dataset.gotoGroup; saveUi(); location.hash = '#saved'; return; }
    if (q('[data-goto-saved]')) { ui.favGroup = ''; saveUi(); $('importDlg').close(); location.hash = '#saved'; render(); return; }
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
    if (/TOUR_API_KEY|503|404/.test(m)) return '서버에 인증키가 설정되지 않았어요.';
    return m.slice(0, 100);
  }
  function readCache() { try { return JSON.parse(localStorage.getItem(C.LIVE_CACHE_KEY) || 'null'); } catch { return null; } }
  function useLive(data, stale) {
    live = {
      status: 'ok', stale,
      meta: { fetchedAt: data.fetchedAt, popularityNote: data.popularityNote },
      places: (data.places || []).filter((p) => p && p.name).map((p, i) => {
        const category = C.TYPES[p.category] ? p.category : C.infer(p.name);
        return { ...p, id: 'live-' + (p.id || i), origin: 'live', category, env: p.env || C.TYPES[category].env };
      }),
    };
  }
  async function loadLive(force) {
    const region = ui.region;
    const cache = readCache();
    if (!force && cache && cache.region === region && Date.now() - new Date(cache.data.fetchedAt).getTime() < LIVE_TTL) { useLive(cache.data, false); render(); return; }
    if (API === '' || CONFIG.disableLive) { live = { status: 'off', places: [], meta: null }; render(); return; }
    live = { status: 'loading', places: [], meta: null }; render();
    try {
      const res = await fetch(`${API}/discover?region=${encodeURIComponent(region)}`, { signal: AbortSignal.timeout(45000) });
      const data = await res.json().catch(() => null);
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
})();
