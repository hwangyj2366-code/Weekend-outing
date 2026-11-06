// 주말에 어디가지? — 화면 동작
(function () {
  'use strict';
  const C = window.WeekendCore;
  const CONFIG = window.WEEKEND_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LIVE_TTL = 12 * 60 * 60 * 1000;

  // ---------- 상태 ----------
  const loaded = C.loadPlaces(localStorage);
  let saved = loaded.places;
  if (loaded.migrated) persist(saved, true);

  const defaults = { tab: 'discover', region: 'sg', env: '', category: '', includeOther: false };
  let ui = { ...defaults };
  try { ui = { ...defaults, ...JSON.parse(localStorage.getItem(C.SETTINGS_KEY) || '{}') }; } catch { /* 기본값 사용 */ }
  let live = { status: CONFIG.discoverUrl ? 'loading' : 'unconfigured', places: [], meta: null };
  let selected = new Set();
  let lastPickId = null;

  function persist(next, quiet) {
    try { C.savePlaces(localStorage, next); saved = next; return true; } catch {
      if (!quiet) alert('브라우저에 저장할 수 없어요. 저장 공간이나 브라우저 설정(사생활 보호 모드)을 확인해 주세요.');
      return false;
    }
  }
  function saveUi() { try { localStorage.setItem(C.SETTINGS_KEY, JSON.stringify({ ...ui, tab: ui.tab })); } catch { /* 선택 사항 */ } }

  // ---------- 조건 UI ----------
  $('region').innerHTML = C.REGIONS.map((r) => `<option value="${r.id}">${esc(r.label)}</option>`).join('');
  const catOptions = Object.keys(C.TYPES).map((t) => `<option value="${esc(t)}">${C.TYPES[t].icon} ${esc(C.label(t))}</option>`).join('');
  $('category').innerHTML = '<option value="">이름으로 자동 분류</option>' + catOptions;
  $('eCategory').innerHTML = catOptions;

  function renderChips() {
    const cats = [...C.OUTING, ...(ui.includeOther ? Object.keys(C.TYPES).filter((k) => !C.TYPES[k].outing) : [])];
    if (ui.category && !cats.includes(ui.category)) ui.category = '';
    $('chips').innerHTML = `<button data-cat="" class="${ui.category ? '' : 'active'}">전체</button>` +
      cats.map((c) => `<button data-cat="${esc(c)}" class="${ui.category === c ? 'active' : ''}">${C.TYPES[c].icon} ${esc(C.label(c))}</button>`).join('');
  }

  function filters() {
    return {
      q: $('search').value, category: ui.category, env: ui.env, region: ui.region,
      includeOther: ui.includeOther, allowUnknownRegion: ui.tab === 'saved',
    };
  }
  function pool() {
    return ui.tab === 'saved' ? saved : C.discoverPool(live.places, C.SEED, saved);
  }
  function visible() { return C.filterPlaces(pool(), filters()); }

  function condText() {
    const r = C.REGIONS.find((x) => x.id === ui.region);
    return [ui.tab === 'saved' ? '내 즐겨찾기' : '새로운 장소', r && r.label, ui.category ? C.label(ui.category) : '모든 카테고리',
      ui.env || '실내·야외 모두', $('search').value.trim() && `“${$('search').value.trim()}”`].filter(Boolean).join(' · ');
  }

  // ---------- 카드 ----------
  function mapLinks(p) {
    const term = encodeURIComponent([p.name, p.region].filter(Boolean).join(' '));
    const url = C.validUrl(p.url);
    if (url) return `<a class="link primary" target="_blank" rel="noopener noreferrer" href="${esc(url)}">🗺 ${esc(C.mapSource(url) || '원본 지도')} 열기</a>`;
    return `<a class="link primary" target="_blank" rel="noopener noreferrer" href="https://map.naver.com/p/search/${term}">네이버 ↗</a>` +
      `<a class="link" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&amp;query=${term}">구글 ↗</a>`;
  }
  function originBadge(p) {
    if (p.origin === 'seed') return '<span class="badge">기본 추천</span>';
    if (p.origin === 'live') return '<span class="badge">공공데이터</span>';
    if (p.list) return `<span class="badge">${esc(p.list)}</span>`;
    return '';
  }
  function hoursBlock(h) {
    if (!h || !(h.usetime || h.restdate || h.infocenter || h.reservation)) return '';
    const row = (k, v) => (v ? `<div><b>${k}</b> ${esc(v)}</div>` : '');
    return `<details><summary>운영 정보</summary>${row('이용시간', h.usetime)}${row('쉬는 날', h.restdate)}${row('예약', h.reservation)}${row('문의', h.infocenter)}` +
      `<div class="muted">출처: ${esc(h.source || '')}${h.updated ? ' · 정보 수정일 ' + esc(h.updated) : ''}</div></details>`;
  }
  function card(p, opts = {}) {
    const t = C.TYPES[p.category] || C.TYPES['기타'];
    const isSaved = ui.tab === 'saved' && !opts.inPick;
    const sel = selected.has(p.id);
    const img = p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.remove()">` : '';
    const meta = [C.label(p.category), p.env, p.region || (isSaved ? '지역 미확인' : '')].filter(Boolean).map(esc).join(' · ');
    const pop = p.popularity ? `<div class="pop">🔥 ${esc(p.popularity.label)}<div class="muted">${esc(p.popularity.source)} · 기준 ${esc(p.popularity.basis)}</div></div>` : '';
    const note = p.note || (p.url ? '지도에서 위치와 방문 정보를 확인해 보세요.' : '장소 이름으로 지도에서 검색할 수 있어요.');
    const actions = isSaved
      ? `<button data-edit="${esc(p.id)}">✏️ 분류·편집</button>`
      : (opts.inPick && ui.tab === 'saved' ? '' : `<button data-save="${esc(p.id)}">♡ 저장</button>` +
        (opts.inPick ? '' : `<label class="link"><input type="checkbox" data-select="${esc(p.id)}" ${sel ? 'checked' : ''}> 선택</label>`));
    return `<article class="card${sel && !opts.inPick ? ' selected' : ''}"><div class="art" style="background:${t.bg}" aria-hidden="true">${t.icon}${img}${originBadge(p)}</div>` +
      `<div class="info"><div class="muted">${meta}</div><h3>${esc(p.name)}</h3>${pop}<p class="muted">${esc(note)}</p>${hoursBlock(p.hours)}` +
      `<div class="actions">${mapLinks(p)}${actions}</div></div></article>`;
  }

  function sourceText() {
    if (ui.tab === 'saved') {
      const n = saved.length;
      return { text: n ? `이 브라우저에 저장된 ${n}곳 중 조건에 맞는 곳이에요. 카드의 ‘분류·편집’에서 카테고리와 실내·야외를 바꿀 수 있어요.` : '아직 저장한 곳이 없어요. 위의 ‘즐겨찾기 가져오기’로 지도 즐겨찾기를 옮겨 오세요.', off: false };
    }
    if (live.status === 'loading') return { text: '최신 인기 장소를 불러오는 중… 그동안 기본 추천을 보여드려요.', off: false };
    if (live.status === 'ok' && live.meta) {
      const m = live.meta;
      return { text: `공공데이터 ${live.places.length}곳 + 기본 추천. ${m.popularityNote || ''} (받은 시각 ${new Date(m.fetchedAt).toLocaleString('ko-KR')}${live.stale ? ', 이전에 받은 데이터' : ''})`, off: !!live.stale };
    }
    if (live.status === 'unconfigured') return { text: '기본 추천(서울·경기 8곳)을 보여드려요. 인기 장소 데이터는 아직 연결되지 않았어요.', off: true };
    return { text: '인기 장소 데이터에 연결하지 못해 기본 추천(서울·경기 8곳)을 보여드려요.', off: true };
  }

  function render() {
    renderChips();
    $('region').value = ui.region;
    $('includeOther').checked = ui.includeOther;
    document.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === ui.tab; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
    document.querySelectorAll('[data-env]').forEach((b) => b.classList.toggle('active', b.dataset.env === ui.env));
    const rows = visible();
    $('heading').textContent = ui.tab === 'saved' ? '내 즐겨찾기' : '아이와 가볼 만한 곳';
    $('count').textContent = rows.length + '곳';
    $('nSaved').textContent = `(${saved.length})`;
    $('nDiscover').textContent = `(${C.discoverPool(live.places, C.SEED, saved).length})`;
    $('conds').textContent = '지금 조건: ' + condText();
    const s = sourceText();
    $('source').textContent = s.text;
    $('source').classList.toggle('offline', s.off);
    $('grid').innerHTML = rows.map((p) => card(p)).join('') || emptyState();
    selected = new Set([...selected].filter((id) => rows.some((p) => p.id === id)));
    $('selbar').classList.toggle('show', ui.tab === 'discover' && selected.size > 0);
    $('selCount').textContent = `${selected.size}곳 선택됨`;
  }
  function emptyState() {
    const hints = [];
    if (ui.category) hints.push('<button data-reset="category">카테고리 전체 보기</button>');
    if (ui.env) hints.push('<button data-reset="env">실내·야외 모두</button>');
    if (ui.region !== 'all') hints.push('<button data-reset="region">전국으로 넓히기</button>');
    if ($('search').value) hints.push('<button data-reset="search">검색어 지우기</button>');
    const msg = ui.tab === 'saved' && !saved.length
      ? '아직 저장한 곳이 없어요.<br><button class="primary big" data-open-import>＋ 즐겨찾기 가져오기</button>'
      : '조건에 맞는 장소가 없어요. 조건을 넓혀 보세요.';
    return `<div class="empty"><p>${msg}</p><div class="actions" style="justify-content:center">${hints.join('')}</div></div>`;
  }

  // ---------- 저장 ----------
  function findInPool(id) { return C.discoverPool(live.places, C.SEED, saved).find((p) => p.id === id); }
  function saveFromDiscover(ids) {
    const items = ids.map(findInPool).filter(Boolean).map((p) => ({
      name: p.name, url: p.url, category: p.category, env: p.env, region: p.region, note: p.note,
      source: p.origin === 'live' ? 'discover-live' : 'discover-seed',
    }));
    const { next, report } = C.mergeImport(saved, items);
    if (!persist(next)) return null;
    ids.forEach((id) => selected.delete(id));
    render();
    return report;
  }

  // ---------- 이벤트 ----------
  document.addEventListener('click', (e) => {
    const t = e.target;
    const tab = t.closest('[data-tab]');
    if (tab) { ui.tab = tab.dataset.tab; selected.clear(); saveUi(); render(); return; }
    const env = t.closest('[data-env]');
    if (env) { ui.env = env.dataset.env; saveUi(); render(); return; }
    const cat = t.closest('[data-cat]');
    if (cat) { ui.category = cat.dataset.cat; saveUi(); render(); return; }
    const reset = t.closest('[data-reset]');
    if (reset) {
      const k = reset.dataset.reset;
      if (k === 'category') ui.category = ''; if (k === 'env') ui.env = ''; if (k === 'region') ui.region = 'all';
      if (k === 'search') $('search').value = '';
      saveUi(); render(); return;
    }
    if (t.closest('[data-open-import]')) { openImport(); return; }
    const sv = t.closest('[data-save]');
    if (sv) {
      const r = saveFromDiscover([sv.dataset.save]);
      if (r && $('choice').open) $('picked').innerHTML = `<p class="report">‘${esc(r.added[0] || r.duplicates[0])}’을(를) 내 즐겨찾기에 저장했어요.</p>` + $('picked').innerHTML.replace(/<button data-save[^>]*>.*?<\/button>/, '');
      return;
    }
    const ed = t.closest('[data-edit]');
    if (ed) { openEdit(ed.dataset.edit); return; }
    if (t.closest('[data-close]')) t.closest('dialog').close();
  });
  document.addEventListener('change', (e) => {
    const id = e.target.dataset && e.target.dataset.select;
    if (!id) return;
    if (e.target.checked) selected.add(id); else selected.delete(id);
    render();
  });
  $('selSave').onclick = () => {
    const r = saveFromDiscover([...selected]);
    if (r) toast(`${r.added.length}곳을 저장했어요${r.duplicates.length ? ` (이미 저장된 ${r.duplicates.length}곳 제외)` : ''}.`);
  };
  $('selClear').onclick = () => { selected.clear(); render(); };
  $('region').onchange = () => { ui.region = $('region').value; saveUi(); render(); loadLive(); };
  $('includeOther').onchange = () => { ui.includeOther = $('includeOther').checked; saveUi(); render(); };
  $('search').oninput = render;

  // ---------- 한 곳 골라줘 ----------
  function doPick() {
    const rows = visible();
    const p = C.pickOne(rows, lastPickId);
    lastPickId = p && p.id;
    $('choiceConds').textContent = `${condText()} 조건의 후보 ${rows.length}곳 중에서 골랐어요.`;
    $('picked').innerHTML = p ? card(p, { inPick: true })
      : `<div class="empty"><p>현재 조건에 맞는 후보가 없어요.</p><p class="muted">${ui.tab === 'saved' && !saved.length ? '내 즐겨찾기가 비어 있어요. 즐겨찾기를 가져오거나 ‘새로운 장소’ 탭에서 골라 보세요.' : '카테고리·실내야외·지역 조건을 넓혀 보세요.'}</p>${emptyState().replace(/^<div class="empty"><p>.*?<\/p>/, '<div>')}`;
    $('reroll').disabled = rows.length < 2;
    if (!$('choice').open) $('choice').showModal();
  }
  $('pick').onclick = doPick;
  $('reroll').onclick = doPick;
  $('closeChoice').onclick = () => $('choice').close();
  $('picked').addEventListener('click', (e) => { if (e.target.closest('[data-reset]')) $('choice').close(); });

  // ---------- 가져오기 ----------
  function openImport() { $('importReport').hidden = true; $('dialog').showModal(); }
  $('open').onclick = openImport;
  $('close').onclick = () => $('dialog').close();

  function showReport(report, title) {
    const list = (arr, max = 8) => arr.length ? `<ul>${arr.slice(0, max).map((x) => `<li>${esc(x)}</li>`).join('')}${arr.length > max ? `<li>…외 ${arr.length - max}개</li>` : ''}</ul>` : '';
    const errs = report.errors.map((e) => (e.line ? `${e.file ? e.file + ' ' : ''}${e.line}번째 줄: ` : (e.file ? e.file + ': ' : '')) + e.error);
    $('importReport').innerHTML =
      `<b>${esc(title)}</b><div>✅ 추가 ${report.added.length}곳</div>` +
      `<div>↩️ 이미 저장되어 건너뜀 ${report.duplicates.length}곳</div>${list(report.duplicates)}` +
      `<div>⚠️ 오류로 건너뜀 ${report.errors.length}건</div>${list(errs)}` +
      (report.warnings.length ? `<div>ℹ️ 확인 필요 ${report.warnings.length}건</div>${list(report.warnings.map((w) => `${w.name}: ${w.warning}`))}` : '') +
      (report.added.length ? '<div class="actions" style="margin-top:8px"><button class="primary" data-goto-saved>내 즐겨찾기 보기</button></div>' : '');
    $('importReport').hidden = false;
    $('importReport').scrollIntoView({ block: 'nearest' });
  }
  $('importReport').addEventListener('click', (e) => {
    if (!e.target.closest('[data-goto-saved]')) return;
    ui.tab = 'saved'; ui.category = ''; saveUi(); $('dialog').close(); render();
  });
  function applyImport(candidates, title) {
    const { next, report } = C.mergeImport(saved, candidates);
    if (!persist(next)) return;
    render();
    showReport(report, title);
  }

  $('form').onsubmit = (e) => {
    e.preventDefault();
    const name = $('name').value.trim(), raw = $('url').value.trim(), url = C.validUrl(raw);
    if (!name || (raw && !url)) { showReport({ added: [], duplicates: [], warnings: [], errors: [{ error: '장소 이름과 올바른 지도 링크(https://…)를 입력해 주세요.' }] }, '추가하지 못했어요'); return; }
    applyImport([{ name, url, category: $('category').value, source: 'link' }], '장소 추가 결과');
    e.target.reset();
  };
  $('pasteAdd').onclick = () => {
    const items = C.fromShareText($('paste').value);
    if (!items.length) { showReport({ added: [], duplicates: [], warnings: [], errors: [{ error: '붙여 넣은 내용에서 장소를 찾지 못했어요.' }] }, '붙여넣기 결과'); return; }
    applyImport(items, '붙여넣기 결과');
    $('paste').value = '';
  };
  $('csv').onchange = async (e) => {
    const files = [...e.target.files];
    const candidates = [];
    for (const file of files) {
      const listName = file.name.replace(/\.(csv|json|geojson)$/i, '');
      try {
        if (file.size > 5_000_000) throw new Error('5MB보다 큰 파일이에요.');
        const text = await file.text();
        const rows = /\.(json|geojson)$/i.test(file.name) || /^\s*[[{]/.test(text) ? C.fromGeoJson(text, listName) : C.fromCsv(text, listName);
        rows.forEach((r) => { if (r.error) r.file = file.name; candidates.push(r); });
      } catch (err) {
        candidates.push({ file: file.name, error: (err && err.message) || '읽을 수 없는 파일이에요. 구글 Takeout의 Saved CSV인지 확인해 주세요.' });
      }
    }
    applyImport(candidates, `파일 ${files.length}개 가져오기 결과`);
    e.target.value = '';
  };

  // ---------- 편집 ----------
  let editingId = null;
  function openEdit(id) {
    const p = saved.find((x) => x.id === id);
    if (!p) return;
    editingId = id;
    $('eName').value = p.name; $('eCategory').value = p.category; $('eEnv').value = p.env || '';
    $('eRegion').value = p.region || ''; $('eUrl').value = p.url || ''; $('eNote').value = p.note || '';
    $('editDlg').showModal();
  }
  $('eCategory').onchange = () => { if (!$('eEnv').value) $('eEnv').value = C.TYPES[$('eCategory').value].env; };
  $('editForm').onsubmit = (e) => {
    e.preventDefault();
    const raw = $('eUrl').value.trim();
    if (raw && !C.validUrl(raw)) { $('eUrl').setCustomValidity('https:// 로 시작하는 링크를 넣어 주세요'); $('eUrl').reportValidity(); $('eUrl').setCustomValidity(''); return; }
    const next = saved.map((p) => p.id !== editingId ? p : C.makePlace({
      ...p, name: $('eName').value, category: $('eCategory').value, env: $('eEnv').value || 'none',
      region: $('eRegion').value, url: raw, note: $('eNote').value,
    }));
    // env를 '모름'으로 둔 경우 카테고리 기본값으로 덮어쓰지 않도록 비워 둡니다.
    if (!$('eEnv').value) next.forEach((p) => { if (p.id === editingId) p.env = ''; });
    if (persist(next)) { $('editDlg').close(); render(); }
  };
  $('eDelete').onclick = () => {
    const p = saved.find((x) => x.id === editingId);
    if (!p || !confirm(`‘${p.name}’을(를) 내 즐겨찾기에서 삭제할까요?`)) return;
    if (persist(saved.filter((x) => x.id !== editingId))) { $('editDlg').close(); render(); }
  };

  function toast(msg) { $('source').textContent = msg; $('source').classList.remove('offline'); }

  // ---------- 공공데이터 인기 장소 ----------
  function readCache() { try { return JSON.parse(localStorage.getItem(C.LIVE_CACHE_KEY) || 'null'); } catch { return null; } }
  function useLive(data, stale) {
    live = {
      status: 'ok', stale,
      meta: { fetchedAt: data.fetchedAt, popularityNote: data.popularityNote },
      places: (data.places || []).filter((p) => p && p.name).map((p, i) => ({
        ...p, id: 'live-' + (p.id || i), origin: 'live',
        category: C.TYPES[p.category] ? p.category : C.infer(p.name),
        env: p.env || (C.TYPES[p.category] || C.TYPES['기타']).env,
      })),
    };
  }
  async function loadLive() {
    if (!CONFIG.discoverUrl) { live = { status: 'unconfigured', places: [], meta: null }; render(); return; }
    const region = ui.region;
    const cache = readCache();
    if (cache && cache.region === region && Date.now() - new Date(cache.data.fetchedAt).getTime() < LIVE_TTL) { useLive(cache.data, false); render(); return; }
    live = { status: 'loading', places: [], meta: null }; render();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(`${CONFIG.discoverUrl}?region=${encodeURIComponent(region)}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (region !== ui.region) return;
      useLive(data, false);
      try { localStorage.setItem(C.LIVE_CACHE_KEY, JSON.stringify({ region, data })); } catch { /* 캐시는 선택 */ }
    } catch {
      if (region !== ui.region) return;
      if (cache && cache.region === region) useLive(cache.data, true);
      else live = { status: 'error', places: [], meta: null };
    }
    render();
  }

  render();
  loadLive();
})();
