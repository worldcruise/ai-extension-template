(() => {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;
  const HCX = (window.HCX = window.HCX || {});
  if (HCX._coreLoaded) return;
  HCX._coreLoaded = true;

  const DEFAULT_SETTINGS = {

    linkedin: true, indeed: true, companyRatings: true,
    ratingsAutoTab: true,
    ratingSource: 'auto',

    companyIntel: true, atsBadge: true,

    showNew: true, dimSeen: true, ghostBadge: true, salaryNorm: true, salarySanity: true,
    layoffFlag: true, trackerStats: true,

    companyCollapse: false, ungroupCarousels: false, compactView: false,
    digest: true, infiniteScroll: true, suppressPopups: false,
    sortMode: 'default',
    filterMode: 'all',

    alerts: false,

    keyboard: true, keyboardHints: true
  };

  const DEFAULT_BLOCKLISTS = {
    companies: [], keywords: [], locations: [], ats: [],
    useAgencies: false, useMLM: true
  };

  const SEEN_DELAY = 1200;
  const CHECK_TIMEOUT = 60000;
  const GHOST_AGE_DAYS = 45;

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    blocklists: { ...DEFAULT_BLOCKLISTS },
    seenSnapshot: new Set(),
    seenBuffer: new Set(),
    marks: {},
    notes: {},
    autoHide: { rules: [], accountWide: false },
    firstSeen: {},
    cards: new Map(),
    hitIndex: new Map(),
    fpIndex: new Map(),
    fpLocIndex: new Map(),
    collapseIndex: new Map(),
    trackerDocs: new Map(),
    focusSlug: null
  };
  HCX.state = state;
  HCX.DEFAULT_BLOCKLISTS = DEFAULT_BLOCKLISTS;
  HCX.consts = { SEEN_DELAY, CHECK_TIMEOUT, GHOST_AGE_DAYS };

  HCX.renderers = [];
  HCX.actions = [];
  HCX.hooks = { onHit: [], onSettings: [], onCardsChanged: [], onNewQuery: [] };

  const D = () => (globalThis.HCX_DATA || null);

  const coData = hit => (hit && D() && D().effectiveCompanyData ? D().effectiveCompanyData(hit) : (hit && hit.enriched_company_data)) || {};
  HCX.coData = coData;

  function normName(s) {
    if (D()) return D().normName(s);
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function normTitle(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function fingerprint(job) {
    return normName(job.company) + '|' + normTitle(job.title);
  }

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'title') n.title = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else n.setAttribute(k, v);
    }
    for (const kid of kids) {
      if (kid == null || kid === false) continue;
      n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return n;
  }

  function debounce(fn, ms) {
    let t = null;
    return (...a) => { if (t) clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  }

  let toastHost = null;
  function toast(msg, opts = {}) {
    if (!toastHost || !toastHost.isConnected) {
      toastHost = el('div', { class: 'hcx-toast-host' });
      document.body.appendChild(toastHost);
    }
    const t = el('div', { class: 'hcx-toast' + (opts.kind ? ' hcx-toast-' + opts.kind : '') });
    if (opts.action) {
      t.appendChild(el('span', { text: msg }));
      t.appendChild(el('button', { class: 'hcx-toast-btn', text: opts.action.label, onclick: () => { opts.action.fn(); t.remove(); } }));
    } else {
      t.textContent = msg;
    }
    toastHost.appendChild(t);
    setTimeout(() => { t.classList.add('hcx-toast-out'); setTimeout(() => t.remove(), 300); }, opts.ms || 3200);
    return t;
  }

  function fmtK(v) { return '$' + (v >= 10000 ? Math.round(v / 1000) + 'k' : Math.round(v)); }
  function fmtEmployees(n) {
    if (!n) return null;
    if (n >= 1000) return Math.round(n / 1000) + 'k';
    return String(n);
  }
  function fmtAgo(ms) {
    if (!ms) return null;
    const d = Math.floor((Date.now() - ms) / 86400000);
    if (d <= 0) return 'today';
    if (d === 1) return '1d';
    if (d < 30) return d + 'd';
    if (d < 365) return Math.floor(d / 30) + 'mo';
    return Math.floor(d / 365) + 'y';
  }

  const noteText = v => typeof v === 'string' ? v : (v && v.text) || '';

  function makeDraggable(elm, key) {
    elm.classList.add('hcx-draggable');
    const storeKey = 'hcxPos:' + key;
    const place = (left, top) => {
      const w = elm.offsetWidth || 200, h = elm.offsetHeight || 40;
      left = Math.max(4, Math.min(innerWidth - w - 4, left));
      top = Math.max(4, Math.min(innerHeight - h - 4, top));
      elm.style.left = left + 'px'; elm.style.top = top + 'px';
      elm.style.right = 'auto'; elm.style.bottom = 'auto'; elm.style.transform = 'none';
    };
    try { const p = JSON.parse(localStorage.getItem(storeKey) || 'null'); if (p) place(p.left, p.top); } catch { }
    elm.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('input, select, textarea, a')) return;
      const r = elm.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY, ox = r.left, oy = r.top;
      let moved = false;
      const move = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 5) return;
        if (!moved) { moved = true; elm.classList.add('hcx-dragging'); try { elm.setPointerCapture(ev.pointerId); } catch { } }
        place(ox + dx, oy + dy); ev.preventDefault();
      };
      const up = () => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
        elm.classList.remove('hcx-dragging');
        if (moved) {
          const r2 = elm.getBoundingClientRect();
          try { localStorage.setItem(storeKey, JSON.stringify({ left: r2.left, top: r2.top })); } catch { }
          elm.__hcxDragged = true; setTimeout(() => { elm.__hcxDragged = false; }, 60);
        }
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    });
    elm.addEventListener('click', e => { if (elm.__hcxDragged) { e.preventDefault(); e.stopPropagation(); } }, true);
  }

  HCX.util = { el, toast, fmtK, fmtEmployees, fmtAgo, normName, noteText, makeDraggable };

  async function loadState() {
    let data = {};
    try {
      data = await api.storage.local.get(
        ['settings', 'blocklists', 'autoHide', 'seen', 'marks', 'notes', 'firstSeen']);
    } catch {  }
    state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    state.blocklists = { ...DEFAULT_BLOCKLISTS, ...(data.blocklists || {}) };
    state.autoHide = { rules: [], accountWide: false, ...(data.autoHide || {}) };
    state.seenSnapshot = new Set(Object.keys(data.seen || {}));
    state.marks = data.marks || {};
    state.notes = data.notes || {};
    state.firstSeen = data.firstSeen || {};
  }

  let flushTimer = null;
  function queueSeen(slug) {
    if (state.seenSnapshot.has(slug) || state.seenBuffer.has(slug)) return;
    state.seenBuffer.add(slug);
    if (!flushTimer) flushTimer = setTimeout(flushSeen, 3000);
  }
  async function flushSeen() {
    flushTimer = null;
    if (!state.seenBuffer.size) return;
    const batch = [...state.seenBuffer];
    state.seenBuffer.clear();
    try {
      const { seen = {} } = await api.storage.local.get('seen');
      const now = Date.now();
      for (const slug of batch) seen[slug] = now;
      const entries = Object.entries(seen);
      if (entries.length > 8000) {
        entries.sort((a, b) => a[1] - b[1]);
        for (const [s] of entries.slice(0, entries.length - 8000)) delete seen[s];
      }
      await api.storage.local.set({ seen });
    } catch {  }
  }
  HCX.queueSeen = queueSeen;

  const saveMarks = debounce(async () => {
    try { await api.storage.local.set({ marks: state.marks }); } catch { }
  }, 250);
  const saveNotes = debounce(async () => {
    try { await api.storage.local.set({ notes: state.notes }); } catch { }
  }, 400);
  const saveFirstSeen = debounce(async () => {
    try { await api.storage.local.set({ firstSeen: state.firstSeen }); } catch { }
  }, 1500);
  HCX.storage = { saveMarks, saveNotes, saveFirstSeen };

  function indexHit(hit) {
    if (!hit) return;
    const id = hit.objectID || hit.id;
    if (id) state.hitIndex.set(String(id), hit);
    const v5 = hit.v5_processed_job_data || {};
    const co = hit.enriched_company_data || {};
    const titles = [...new Set([v5.core_job_title, hit.job_information?.title].filter(Boolean))];
    const companies = [...new Set([v5.company_name, co.name].filter(Boolean))];
    const loc = normTitle(v5.formatted_workplace_location || '');
    let primary = true;
    for (const c of companies) for (const t of titles) {
      const fp = normName(c) + '|' + normTitle(t);
      if (!state.fpIndex.has(fp)) state.fpIndex.set(fp, hit);
      const fpLoc = fp + '|' + loc;
      if (!state.fpLocIndex.has(fpLoc)) state.fpLocIndex.set(fpLoc, hit);
      if (primary && !state.firstSeen[fp]) { state.firstSeen[fp] = Date.now(); saveFirstSeen(); }
      primary = false;
    }

    const ck = hit.collapse_key;
    if (ck && id) {
      let set = state.collapseIndex.get(ck);
      if (!set) { set = new Set(); state.collapseIndex.set(ck, set); }
      set.add(String(id));
    }
    for (const h of HCX.hooks.onHit) { try { h(hit); } catch { } }
  }
  function hitForJob(job) {
    const fp = fingerprint(job);

    return state.fpLocIndex.get(fp + '|' + normTitle(job.location || '')) || state.fpIndex.get(fp) || null;
  }
  function groupHits(collapseKey) {
    const set = collapseKey ? state.collapseIndex.get(collapseKey) : null;
    if (!set) return [];
    return [...set].map(id => state.hitIndex.get(id)).filter(Boolean);
  }
  HCX.data = { groupHits };

  const pager = {
    buildId: null, searchStateStr: '{}', page: 1,
    loading: false, done: false, enabled: false, builtFor: null,
    gen: 0, errored: false, retryAt: 0
  };
  HCX.pager = pager;

  function injectBridge() {
    try {
      const s = document.createElement('script');
      s.src = api.runtime.getURL('content/inject.js');
      s.dataset.hcx = '1';
      (document.head || document.documentElement).appendChild(s);
      s.onload = () => s.remove();
    } catch {  }
  }

  function onBridgeMessage(ev) {
    if (ev.source !== window) return;
    const m = ev.data;
    if (!m || m.__hcx !== true) return;
    if (m.type === 'HCX_INIT' || m.type === 'HCX_SEARCH') {
      if (m.buildId) pager.buildId = m.buildId;
      const hits = Array.isArray(m.hits) ? m.hits : [];
      for (const h of hits) indexHit(h);
      const stateStr = m.searchStateStr || '{}';

      const isNewQuery = pager.builtFor !== null && pager.builtFor !== stateStr;
      pager.searchStateStr = stateStr;
      if (m.type === 'HCX_INIT' || isNewQuery || pager.builtFor === null) {
        if (isNewQuery) { resetSynthetic(); for (const fn of HCX.hooks.onNewQuery) { try { fn(); } catch { } } }
        pager.gen++;
        pager.page = m.page || 1;
        pager.done = !!m.isLastPage;
        pager.loading = false;
        pager.errored = false;
        pager.builtFor = stateStr;
      } else {

        pager.page = Math.max(pager.page, m.page || pager.page);
        if (m.isLastPage) pager.done = true;
      }
      pager.enabled = !!pager.buildId && isSearchView();
      scheduleScan();
    } else if (m.type === 'HCX_NAV') {
      scheduleScan();
    }
  }

  function isSearchView() {
    const p = location.pathname;
    return p === '/' || p === '' || p === '/index';
  }
  HCX.isSearchView = isSearchView;
  function isJobPage() { return /^\/job\//.test(location.pathname); }
  function isTrackerView() { return /^\/myhiringcafe\//.test(location.pathname) || location.pathname === '/inbox'; }

  function isInternalPage() { return /^\/internal(\/|$)/.test(location.pathname); }
  HCX.isInternalPage = isInternalPage;

  let syntheticGrid = null, sentinel = null, sentinelVisible = false, hiddenPagination = null;
  const syntheticGroups = new Map();

  function nativeGrid() {
    const link = document.querySelector('a[href^="/job/"]');
    return link ? link.closest('div[class*="grid-cols"]') : null;
  }

  function ensureSentinel() {
    if (!state.settings.infiniteScroll || !pager.enabled || !isSearchView()) return;
    const grid = nativeGrid();
    if (!grid) return;

    if (!syntheticGrid) { syntheticGrid = el('div', { id: 'hcx-more-grid' }); syntheticGrid.style.display = 'contents'; }
    if (syntheticGrid.parentElement !== grid) grid.appendChild(syntheticGrid);
    if (!sentinel) { sentinel = el('div', { class: 'hcx-sentinel' }); sentinelIO.observe(sentinel); }
    if (!sentinel.isConnected || sentinel.previousElementSibling !== grid) grid.insertAdjacentElement('afterend', sentinel);
  }

  const sentinelIO = new IntersectionObserver(entries => {
    for (const e of entries) { sentinelVisible = e.isIntersecting; if (e.isIntersecting) loadNextPage(); }
  }, { rootMargin: '1000px' });

  async function loadNextPage() {
    if (pager.loading || pager.done || !pager.enabled || !state.settings.infiniteScroll) return;
    if (!pager.buildId) return;
    if (pager.errored && Date.now() < pager.retryAt) return;
    pager.loading = true;
    const gen = pager.gen;
    const pageToFetch = pager.page + 1;
    if (sentinel) sentinel.textContent = 'Loading more jobs…';
    try {

      const url = `${location.origin}/_next/data/${pager.buildId}/index.json?searchState=` +
        encodeURIComponent(pager.searchStateStr) + '&page=' + pageToFetch;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const pp = (await res.json()).pageProps || {};
      if (pager.gen !== gen) return;
      const hits = (pp.ssrHits || []).filter(h => !h.is_hc_pinned);
      pager.page = pageToFetch;
      pager.errored = false;
      if (pp.ssrIsLastPage || !hits.length) pager.done = true;
      for (const hit of hits) { indexHit(hit); renderSyntheticHit(hit); }
      if (sentinel) sentinel.textContent = pager.done ? 'That’s all of them.' : '';
      scheduleScan();
    } catch (e) {
      if (pager.gen !== gen) return;

      pager.errored = true;
      pager.retryAt = Date.now() + 6000;
      if (sentinel) sentinel.textContent = 'Couldn’t load more — retrying shortly (or use the page numbers below).';
      updatePaginationVisibility();
    } finally {
      if (pager.gen === gen) {
        pager.loading = false;
        if (sentinelVisible && !pager.done && !pager.errored) setTimeout(loadNextPage, 250);
        else if (sentinelVisible && pager.errored && !pager.done) setTimeout(() => { if (sentinelVisible) loadNextPage(); }, 6300);
      }
    }
  }

  function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function canonicalJobPath(hit) {
    const id = hit.requisition_id || '';
    if (!id) return null;
    if (!/^[A-Za-z0-9]+$/.test(id)) return '/job/' + encodeURIComponent(id);
    const v5 = hit.v5_processed_job_data || {}, co = coData(hit);
    const title = v5.core_job_title || hit.job_information?.title || '';
    const company = co.name || v5.company_name || '';
    const city = (Array.isArray(v5.workplace_cities) && v5.workplace_cities[0]) ||
      (v5.formatted_workplace_location || '').split(' or ')[0].split(',').slice(0, 2).join(' ');
    let slug = slugify([title, company, city].filter(Boolean).join(' ')).slice(0, 70).replace(/-+$/, '');
    return '/job/' + encodeURIComponent(slug ? slug + '-' + id : id);
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  const SICONS = {
    clock: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
    pin: 'M15 10.5a3 3 0 11-6 0 3 3 0 016 0z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z',
    doc: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
    eye: 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    save: 'M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z',
    plane: 'M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5',
    arrow: 'M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25',
    chevL: 'M15.75 19.5L8.25 12l7.5-7.5', chevR: 'M8.25 4.5l7.5 7.5-7.5 7.5',

    share: 'M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15M9 12l3 3m0 0l3-3m-3 3V2.25',
    globe: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418',
    flag: 'M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5'
  };
  function synIcon(name, cls) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.5'); s.setAttribute('class', cls);
    const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('d', SICONS[name]);
    s.appendChild(p); return s;
  }
  HCX.util.synIcon = synIcon;
  HCX.canonicalJobPath = canonicalJobPath;
  const jobOf = hit => {
    const v5 = hit.v5_processed_job_data || {}, co = coData(hit);
    return { title: v5.core_job_title || hit.job_information?.title || '', company: v5.company_name || co.name || '', location: v5.formatted_workplace_location || '' };
  };

  function synJobContent(hit) {
    const v5 = hit.v5_processed_job_data || {}, co = coData(hit);
    const job = jobOf(hit);
    const top = el('div', { class: 'flex flex-col w-full' });
    const ageMs = v5.estimated_publish_date_millis || (v5.estimated_publish_date ? Date.parse(v5.estimated_publish_date) : null);
    const age = fmtAgo(ageMs);
    if (age) top.appendChild(el('div', { class: 'absolute top-2 right-2 text-xs hidden md:flex items-center space-x-0.5 text-gray-400 font-medium' }, synIcon('clock', 'h-3 w-3 flex-none'), el('span', { text: age })));
    const techStack = (v5.technical_tools || []).slice(0, 6).join(', ');
    top.appendChild(el('div', { class: 'mt-1 mt-14 md:mt-1 md:mr-10' }, el('span', { class: 'w-full font-bold text-start ' + (techStack ? 'line-clamp-2' : 'line-clamp-3'), text: job.title })));
    top.appendChild(el('div', { class: 'mt-1 flex items-center space-x-1 rounded text-xs px-1 font-medium border bg-gray-50 w-fit text-gray-700' }, synIcon('pin', 'h-3 w-3 flex-none'), el('span', { class: 'line-clamp-2', text: job.location || '—' })));
    const pills = el('div', { class: 'flex flex-wrap gap-1.5 mt-2 w-full' });
    const comp = fmtSalaryYr(v5) || fmtSalaryOther(v5);
    if (comp) pills.appendChild(el('span', { class: 'border rounded text-xs px-1 flex-none border-green-600 text-green-800', text: comp }));
    else if (v5.is_compensation_transparent === false) pills.appendChild(el('span', { class: 'border rounded text-xs px-1 flex-none border-red-800/10 text-red-800/50', text: 'Undisclosed Salary' }));
    if (v5.workplace_type) pills.appendChild(el('span', { class: 'border rounded text-xs px-1 flex-none ' + (/remote/i.test(v5.workplace_type) ? 'border-cyan-700 text-cyan-700' : 'text-black border-gray-400'), text: v5.workplace_type }));
    for (const c of (v5.commitment || []).slice(0, 1)) pills.appendChild(el('span', { class: 'border rounded text-xs px-1 flex-none text-black border-gray-400', text: c }));
    top.appendChild(pills);

    const mid = el('div', { class: 'flex flex-col mt-4 mb-2 space-y-2.5 text-sm w-full' });
    const coRow = el('div', { class: 'flex mb-4 mt-2 md:my-0 w-full ' + (co.homepage_uri ? 'items-center space-x-4 md:space-x-3 lg:space-x-2' : 'space-x-1') });
    let domain = '';
    try { domain = new URL((co.homepage_uri || '').startsWith('http') ? co.homepage_uri : 'https://' + co.homepage_uri).hostname; } catch { }
    if (domain) coRow.appendChild(el('div', { class: 'flex flex-none h-14 w-14 rounded border border-gray-500 ring-2 ring-gray-300 overflow-hidden bg-white' },
      el('img', { class: 'h-full w-full object-contain', src: 'https://s2.googleusercontent.com/s2/favicons?domain=' + domain + '&sz=128', alt: job.company })));
    const coName = el('span', { class: 'line-clamp-3 font-light' }, el('span', { class: 'font-bold', text: job.company }));
    if (co.stock_symbol) coName.appendChild(el('span', { class: 'inline-flex items-center ml-1 px-1 rounded text-[10px] font-medium text-gray-400 border border-gray-200 align-middle leading-tight', text: (co.stock_exchange ? co.stock_exchange + ': ' : '') + co.stock_symbol }));
    if (co.tagline) coName.appendChild(document.createTextNode(': ' + (co.tagline.length > 350 ? co.tagline.slice(0, 350) + '…' : co.tagline)));
    coRow.appendChild(coName);
    mid.appendChild(coRow);
    const reqBox = el('div', { class: 'flex space-x-1 w-full' }, synIcon('doc', 'h-4 w-4 flex-none text-gray-600'));
    const reqSpan = el('span', { class: (techStack ? 'line-clamp-5' : 'line-clamp-6') + ' font-light' });
    if (v5.min_industry_and_role_yoe) reqSpan.appendChild(el('span', { class: 'font-bold text-gray-500' }, el('span', { class: 'bg-sky-50/30 border border-violet-600/30 rounded text-xs px-1 mr-1 w-fit font-medium text-violet-900', text: v5.min_industry_and_role_yoe + ' YOE' })));
    reqSpan.appendChild(document.createTextNode((v5.requirements_summary || '').slice(0, 350)));
    reqBox.appendChild(reqSpan);
    mid.appendChild(reqBox);
    if (techStack) mid.appendChild(el('div', { class: 'flex flex-col space-y-1' }, el('div', { class: 'flex space-x-1' }, synIcon('doc', 'h-4 w-4 flex-none text-gray-600'), el('span', { class: 'line-clamp-2 font-light', text: techStack }))));
    return [top, mid];
  }

  function renderSyntheticHit(hit) {
    if (!state.settings.infiniteScroll) return;
    if (!syntheticGrid) ensureSentinel();
    if (!syntheticGrid) return;
    const id = String(hit.objectID || hit.id);
    if (!jobOf(hit).title) return;
    for (const c of state.cards.values()) {
      if (c.surface !== 'synthetic' && c.hit && String(c.hit.objectID || c.hit.id) === id) return;
    }
    const ck = hit.collapse_key || ('id:' + id);
    let group = syntheticGroups.get(ck);
    if (group) {
      if (group.hits.some(h => String(h.objectID || h.id) === id)) return;
      group.hits.push(hit);
      updateCarousel(group);
      return;
    }
    group = { ck, hits: [hit], index: 0 };
    syntheticGroups.set(ck, group);
    buildSyntheticCard(group);
  }

  function buildHoverOverlay(group) {
    const cur = () => group.hits[group.index];
    const siteOf = () => coData(cur()).homepage_uri || '';
    const pathOf = () => canonicalJobPath(cur());
    const stop = e => { e.preventDefault(); e.stopPropagation(); };

    const shareBtn = el('button', { type: 'button', title: 'Share Job', class: ' bg-white p-3 rounded-full flex-none text-black',
      onclick: e => { stop(e); const url = location.origin + (pathOf() || '/'); (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied')).catch(() => window.open(url, '_blank', 'noopener')); } },
      synIcon('share', 'h-5 w-5 flex-none'));
    const siteBtn = el('button', { type: 'button', title: 'Company Website', class: 'bg-white p-3 rounded-full flex-none text-black',
      onclick: e => { stop(e); const w = siteOf(); if (w) window.open(/^https?:/i.test(w) ? w : '//' + w, '_blank', 'noopener'); } },
      synIcon('globe', 'h-5 w-5 flex-none'));
    const topLeft = el('div', { class: 'absolute top-0 z-10 m-2 flex flex-col items-start space-y-2' }, shareBtn, siteBtn);

    const saveBtn = el('button', { type: 'button', class: 'px-4 py-3 bg-pink-600 hover:bg-pink-800 text-white rounded-full flex-none text-base', text: 'Save',
      onclick: e => { stop(e); if (HCX.accountMark) HCX.accountMark(cur(), 'Saved'); } });
    const appliedBtn = el('button', { type: 'button', class: 'p-2 bg-white hover:bg-gray-100 rounded flex-none text-black', text: 'Mark Applied',
      onclick: e => { stop(e); const ctl = group.card.__hcx; if (ctl && HCX.setMark) HCX.setMark(ctl, 'a'); if (HCX.accountMark) HCX.accountMark(cur(), 'Applied'); } });
    const topRight = el('div', { class: 'absolute top-0 right-0 z-10 m-2 flex flex-col items-start text-xs font-bold' },
      el('div', { class: 'flex items-center space-x-2' }, saveBtn, appliedBtn));

    const applyBtn = el('button', { type: 'button', class: 'bg-white py-2 px-4 text-xs rounded-full font-medium z-10 text-black', text: 'Apply Directly',
      onclick: e => { stop(e); const u = (cur().apply_url) || (location.origin + (pathOf() || '/')); window.open(u, '_blank', 'noopener'); } });
    const moreBtn = el('button', { type: 'button', title: 'Report job', class: 'bg-white p-2 rounded-full flex-none text-black',
      onclick: e => { stop(e); const ctl = group.card.__hcx; if (ctl && HCX.reportFocused) HCX.reportFocused(ctl); } }, synIcon('flag', 'h-4 w-4 flex-none'));
    const bottom = el('div', { class: 'absolute bottom-0 w-full p-2 h-full' },
      el('div', { class: 'flex justify-between items-end text-sm w-full space-x-2 h-full' }, applyBtn, moreBtn));

    const overlay = el('div', { class: 'absolute inset-y-0 left-0 w-full cursor-zoom-in hcx-syn-hover',
      onclick: e => { const p = pathOf(); if (p) { e.preventDefault(); location.assign(p); } } },
      el('div', { class: 'absolute inset-y-0 left-0 bg-black w-full opacity-50' }), topLeft, topRight, bottom);
    group.hoverSiteBtn = siteBtn;
    return overlay;
  }

  function buildSyntheticCard(group) {
    const wrap = el('div', { class: 'relative xl:z-10 hcx-syn-wrap' });
    const card = el('div', { class: 'relative bg-white rounded-xl border border-gray-200 shadow hover:border-gray-500 md:hover:border-gray-200' });
    const rootBox = el('div', { class: 'md:h-[340px] relative flex flex-col items-start w-full rounded-x-lg rounded-t-lg py-1.5 px-3 overflow-hidden cursor-pointer md:cursor-default transition-opacity duration-300 opacity-100' });
    const footer = el('div', { class: 'flex flex-col items-center divide-y w-full rounded-b-lg py-2 border-t bg-white' });
    const jobLink = el('a', { class: 'flex items-center hover:underline space-x-1 text-xs font-medium hover:scale-105 transition-all duration-100 text-gray-500 hover:text-gray-600', target: '_blank', rel: 'noopener' }, el('span', { text: 'Job Posting' }), synIcon('arrow', 'h-2.5 w-2.5 flex-none'));
    const carousel = el('div', { class: 'flex items-center space-x-2' });
    const applyLink = el('a', { class: 'text-xs hover:underline font-medium hover:scale-105 transition-all duration-100 text-gray-500 hover:text-gray-600', target: '_blank', rel: 'noopener', text: 'Apply ↗' });
    const statsRow = el('div', { class: 'flex items-center space-x-6 text-xs' },
      el('span', { class: 'flex items-center font-extralight space-x-1' }, synIcon('eye', 'h-2.5 w-2.5 flex-none'), el('span', { class: 'font-normal', text: '0' }), el('span', { text: 'views' })),
      el('span', { class: 'flex items-center font-extralight space-x-1' }, synIcon('save', 'h-2.5 w-2.5 flex-none'), el('span', { class: 'font-normal', text: '0' }), el('span', { text: 'saves' })),
      el('span', { class: 'flex items-center font-extralight space-x-1' }, synIcon('plane', 'h-2.5 w-2.5 flex-none'), el('span', { class: 'font-normal', text: '0' }), el('span', { text: 'applications' })));
    footer.append(
      el('div', { class: 'flex justify-between items-center space-x-2 pb-2 px-2 w-full' }, jobLink, carousel, applyLink),
      el('div', { class: 'w-full pt-2 px-2 flex justify-center' }, statsRow));

    const overlay = buildHoverOverlay(group);
    const bodyWrap = el('div', { class: 'relative hcx-syn-body overflow-hidden rounded-t-lg' }, rootBox, overlay);
    card.append(bodyWrap, footer);
    wrap.appendChild(card);
    syntheticGrid.appendChild(wrap);
    Object.assign(group, { wrap, card, rootBox, jobLink, carousel, applyLink, statsRow });
    renderGroupJob(group);
  }

  function updateCarousel(group) {
    const c = group.carousel;
    if (!c) return;
    c.textContent = '';
    const n = group.hits.length;
    if (n <= 1) return;
    const btn = (name, dir, disabled) => el('button', { type: 'button', class: 'bg-gray-200 md:bg-white/0 border md:border-none border-gray-300 p-1 md:p-0 text-black md:text-gray-400 rounded-full md:rounded-none' + (disabled ? ' opacity-40' : ''), onclick: e => { e.preventDefault(); e.stopPropagation(); if (!disabled) { group.index = Math.max(0, Math.min(n - 1, group.index + dir)); renderGroupJob(group); } } }, synIcon(name, 'h-4 w-4 flex-none'));
    c.appendChild(btn('chevL', -1, group.index <= 0));
    const dots = el('div', { class: 'flex items-center space-x-1' });
    for (let i = 0; i < Math.min(n, 8); i++) dots.appendChild(el('span', { class: 'rounded-full ' + (i === group.index ? 'bg-gray-600 h-1.5 w-1.5' : 'bg-gray-300 h-1 w-1') }));
    if (n > 8) dots.appendChild(el('span', { class: 'text-[10px] text-gray-400', text: '+' + (n - 8) }));
    c.appendChild(dots);
    c.appendChild(btn('chevR', 1, group.index >= n - 1));
  }

  function renderGroupJob(group) {
    const hit = group.hits[group.index];
    const job = jobOf(hit);
    const [top, mid] = synJobContent(hit);
    group.rootBox.textContent = '';
    group.rootBox.append(top, mid);
    const jobPath = canonicalJobPath(hit);
    group.jobLink.href = jobPath || hit.apply_url || '#';
    group.applyLink.href = hit.apply_url || '#';

    if (group.hoverSiteBtn) {
      const site = coData(hit).homepage_uri || '';
      group.hoverSiteBtn.style.display = site ? '' : 'none';
    }
    if (group.statsRow && HCX.engValues) {
      const v = HCX.engValues(hit);
      const nums = group.statsRow.querySelectorAll('span.font-normal');
      const fmt = HCX.fmtEngNum || String;
      if (nums[0]) nums[0].textContent = fmt(v.views);
      if (nums[1]) nums[1].textContent = fmt(v.saves);
      if (nums[2]) nums[2].textContent = fmt(v.apps);
    }
    updateCarousel(group);

    const old = group.card.__hcx;
    if (old) {
      group.cache = group.cache || {};
      group.cache[old.slug] = { dispatched: old.dispatched, results: old.results, rating: old.rating, ats: old.ats };
      group.card.querySelectorAll(':scope .hcx-badges, :scope .hcx-actions, :scope .hcx-chip, :scope .hcx-intel').forEach(el2 => el2.remove());
      teardown(old);
    }
    const slug = '/hcx/' + (hit.objectID || hit.id);
    decorate(slug, group.card, { surface: 'synthetic', hit, job, openUrl: jobPath ? location.origin + jobPath : hit.apply_url, applyUrl: hit.apply_url, seed: group.cache && group.cache[slug] });
  }

  function fmtSalaryOther(v5) {
    const map = [['hourly', '/hr'], ['daily', '/day'], ['weekly', '/wk'], ['monthly', '/mo']];
    for (const [k, suf] of map) {
      const lo = v5[k + '_min_compensation'], hi = v5[k + '_max_compensation'];
      if (lo || hi) { const f = v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v); return (lo && hi && hi !== lo ? f(lo) + '-' + f(hi) : f(lo || hi)) + suf; }
    }
    return null;
  }

  function fmtSalaryYr(v5) {
    const lo = v5.yearly_min_compensation, hi = v5.yearly_max_compensation;
    if (!lo && !hi) return null;
    const k = v => '$' + Math.round(v / 1000) + 'k';
    if (lo && hi && hi !== lo) return k(lo) + '-' + k(hi) + '/yr';
    return k(lo || hi) + '/yr';
  }
  HCX.fmtSalaryYr = fmtSalaryYr;

  function resetSynthetic() {
    for (const ctl of [...state.cards.values()]) {
      if (ctl.slug.startsWith('/hcx/')) { teardown(ctl); (ctl.root.parentElement || ctl.root).remove(); }
    }
    syntheticGroups.clear();
    syntheticGrid?.remove(); syntheticGrid = null;
    if (sentinel) { sentinelIO.unobserve(sentinel); sentinel.remove(); sentinel = null; }
  }

  function updatePaginationVisibility() {
    if (hiddenPagination && !hiddenPagination.isConnected) hiddenPagination = null;

    const hide = state.settings.infiniteScroll && pager.enabled && isSearchView() && !pager.errored;
    if (hide && !hiddenPagination) {
      const numeric = [...document.querySelectorAll('button, a')]
        .filter(b => /^\d+$/.test(b.textContent.trim()) && !b.closest('#hcx-more-grid'));
      if (numeric.length >= 3) {
        let bar = numeric[0].parentElement;
        while (bar && bar !== document.body && !bar.contains(numeric[numeric.length - 1])) bar = bar.parentElement;
        if (bar && bar !== document.body) { bar.classList.add('hcx-hidden-pagination'); hiddenPagination = bar; }
      }
    } else if (!hide && hiddenPagination) {
      hiddenPagination.classList.remove('hcx-hidden-pagination'); hiddenPagination = null;
    }
  }

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const ctl = e.target.__hcx;
      if (!ctl) continue;
      if (e.isIntersecting && e.intersectionRatio >= 0.4) {
        if (!ctl.seenTimer) ctl.seenTimer = setTimeout(() => { ctl.seenTimer = null; queueSeen(ctl.slug); }, SEEN_DELAY);
      } else if (ctl.seenTimer) { clearTimeout(ctl.seenTimer); ctl.seenTimer = null; }
    }
  }, { threshold: [0, 0.4] });

  function extractJob(root) {
    const titleEl = root.querySelector('span[class*="font-bold"][class*="line-clamp"]');
    const title = titleEl?.textContent.trim() || '';
    let location = '';
    for (const e of root.querySelectorAll('span[class*="line-clamp"]')) {
      if (e === titleEl) continue;
      if (String(e.className).includes('font-bold')) continue;
      const t = e.textContent.trim();
      if (t) { location = t; break; }
    }
    let company = '';
    for (const e of root.querySelectorAll('span[class*="font-bold"]')) {
      if (e === titleEl) continue;
      const cls = String(e.className);
      if (cls.includes('line-clamp') || cls.includes('text-gray')) continue;
      const t = e.textContent.trim();
      if (!t || /^\d+\+?\s*YOE/i.test(t)) continue;
      company = t; break;
    }
    if (!company) { const img = root.querySelector('img[alt]'); if (img?.alt?.length > 1) company = img.alt.trim(); }
    return { title, company, location };
  }

  function decorate(slug, root, opts = {}) {
    const job = opts.job || extractJob(root);
    const hit = opts.hit || hitForJob(job);
    const seed = opts.seed;
    const ctl = {
      slug, root, job, hit,
      surface: opts.surface || 'grid',
      openUrl: opts.openUrl || (location.origin + slug),
      applyUrl: opts.applyUrl || hit?.apply_url || null,
      dispatched: seed ? { ...seed.dispatched } : {},
      results: seed ? { ...seed.results } : {},
      rating: seed ? seed.rating : null,
      ats: seed ? seed.ats : undefined,
      seenTimer: null
    };
    root.__hcx = ctl;
    root.dataset.hcxSlug = slug;
    root.classList.add('hcx-card', 'hcx-surface-' + ctl.surface);
    state.cards.set(slug, ctl);

    if (state.settings.dimSeen && state.seenSnapshot.has(slug)) root.classList.add('hcx-seen');
    if (ctl.surface !== 'jobpage' && ctl.surface !== 'modal' && ctl.surface !== 'tracker') io.observe(root);
    runRenderers(ctl);
    return ctl;
  }

  function runRenderers(ctl) {
    for (const r of HCX.renderers) { try { r(ctl); } catch (e) {  } }
  }

  function redecorate(ctl) {
    if (!ctl.hit) ctl.hit = hitForJob(ctl.job);
    if (!ctl.applyUrl && ctl.hit) ctl.applyUrl = ctl.hit.apply_url || null;
    runRenderers(ctl);
  }
  HCX.redecorate = redecorate;

  function teardown(ctl) {
    io.unobserve(ctl.root);
    if (ctl.seenTimer) clearTimeout(ctl.seenTimer);
    state.cards.delete(ctl.slug);
    delete ctl.root.__hcx;
  }

  function findGridCards() {
    const out = [];
    const seenRoots = new Set();
    for (const link of document.querySelectorAll('a[href^="/job/"]')) {
      if (link.closest('#hcx-more-grid')) continue;
      const slug = link.getAttribute('href');
      const root = link.closest('div[class*="rounded-xl"]') || link.closest('div.relative');
      if (!root || seenRoots.has(root)) continue;
      seenRoots.add(root);
      out.push({ slug, root, surface: 'grid' });
    }
    return out;
  }

  function readBriefJD(h2) {
    if (!h2 || h2.closest('#hcx-more-grid')) return null;
    const title = h2.textContent.trim();
    if (!title || title.length < 2) return null;
    let company = '', location = '';
    const sib = h2.nextElementSibling;
    if (sib) { const c = sib.querySelector('span'); if (c) company = c.textContent.replace(/^@\s*/, '').trim(); }
    const locRow = sib && sib.nextElementSibling;
    if (locRow) { const l = locRow.querySelector('span'); if (l) location = l.textContent.trim(); }
    return { h2, root: h2.parentElement, title, company, location };
  }
  function briefTitles(scope) {
    return [...scope.querySelectorAll('h2.font-extrabold, h2[class*="text-3xl"]')];
  }

  let hydratedAt = 0;
  function isHydrated() {
    if (document.readyState !== 'complete') return false;
    if (!hydratedAt) hydratedAt = performance.now() + 400;
    return performance.now() >= hydratedAt;
  }

  function findJobDrawer() {
    for (const dlg of document.querySelectorAll('.chakra-portal [role="dialog"].chakra-modal__content')) {
      if (!dlg.querySelector('[data-testid="drawer-header-bar"]')) continue;
      const h2 = briefTitles(dlg)[0];
      const jd = readBriefJD(h2);
      if (!jd) continue;
      const full = dlg.querySelector('[data-testid="drawer-header-actions"] a[href^="/job/"]') || dlg.querySelector('a[href^="/job/"]');
      return { dlg, jd, jobPath: full ? full.getAttribute('href') : null };
    }
    return null;
  }

  function jobPageHeader() {
    const scope = document.querySelector('main') || document.body;
    const h1 = [...scope.querySelectorAll('h1')]
      .find(h => !h.closest('[role="dialog"]') && !h.closest('#hcx-more-grid') && h.textContent.trim());
    if (!h1 || !h1.parentElement) return null;
    const col = h1.parentElement;
    let root = col;
    for (let i = 0; i < 2; i++) {
      const p = root.parentElement;
      if (!p || p === document.body || p.tagName === 'MAIN') break;
      root = p;
    }
    const next = h1.nextElementSibling;
    let company = next && /font-bold/.test(String(next.className)) ? next.textContent.trim() : '';
    if (!company) { const img = root.querySelector('img[alt]'); if (img && img.alt.trim().length > 1) company = img.alt.trim(); }
    let location = '';
    for (const d of col.children) {
      if (d === h1 || d === next || !d.querySelector || d.querySelector('a') || !d.querySelector('svg')) continue;
      const t = d.textContent.trim();
      if (t) { location = t; break; }
    }
    return { root, title: h1.textContent.trim(), company, location };
  }

  function findJobPage() {
    if (!/^\/job\//.test(location.pathname)) return null;
    return jobPageHeader();
  }
  function jobPageHit() {
    try {
      const j = JSON.parse(document.getElementById('__NEXT_DATA__').textContent).props?.pageProps?.job;
      if (j && (j.objectID || j.id)) { indexHit(j); return j; }
    } catch { }
    return null;
  }

  function ensureDetailSurface(slug, root, surface, opts) {
    const existing = state.cards.get(slug);
    if (existing && existing.root === root) {
      if (!root.querySelector(':scope .hcx-badges')) redecorate(existing);
      return;
    }
    if (existing) teardown(existing);
    if (root.__hcx && root.__hcx.slug !== slug) teardown(root.__hcx);
    decorate(slug, root, { surface, ...opts });
  }

  function findTrackerCards() {
    if (!isTrackerView()) return [];
    return [...document.querySelectorAll('div[data-testid="tracker-card"]')].map(root => ({ root, surface: 'tracker' }));
  }

  function extractTrackerJob(root) {
    const titleEl = root.querySelector('div[class*="font-bold"][class*="text-start"]');
    const title = titleEl ? titleEl.textContent.trim() : '';
    let company = '';
    for (const e of root.querySelectorAll('span[class*="line-clamp"] > span[class*="font-bold"]')) {
      if (String(e.className).includes('text-gray')) continue;
      const t = e.textContent.trim();
      if (!t || /YOE/i.test(t)) continue;
      company = t; break;
    }
    const locEl = root.querySelector('div[class*="text-xs"] span[class*="line-clamp"]');
    const location = locEl ? locEl.textContent.trim() : '';
    if (title && company) return { title, company, location };
    const f = extractJob(root);
    return { title: title || f.title, company: company || f.company, location: location || f.location };
  }

  function trackerHit(job) {
    const direct = hitForJob(job);
    if (direct) return direct;
    const nt = normTitle(job.title), nc = normName(job.company);
    if (!nt || !nc) return null;
    for (const doc of state.trackerDocs.values()) {
      const cos = [doc.v5_processed_job_data?.company_name, doc.enriched_company_data?.name];
      if (!cos.some(c => c && normName(c) === nc)) continue;
      const titles = [doc.job_title, doc.job_information?.title, doc.v5_processed_job_data?.core_job_title];
      if (titles.some(t => t && normTitle(t) === nt)) return doc;
    }
    return null;
  }

  const trackerFetch = { at: 0, inflight: false };
  async function ensureTrackerHits(force = false) {
    if (!/^\/myhiringcafe\/tracker/.test(location.pathname)) return;
    if (trackerFetch.inflight || !HCX.freshCreds) return;
    if (!force && Date.now() - trackerFetch.at < 5 * 60000) return;
    trackerFetch.inflight = true;
    try {
      trackerFetch.at = Date.now() - 4 * 60000;
      const creds = await HCX.freshCreds();
      if (!creds || !creds.token) return;
      const r = await api.runtime.sendMessage({ type: 'HCX_FS_TRACKER', token: creds.token, uid: creds.uid });
      if (!r || !r.ok || !Array.isArray(r.docs)) return;
      trackerFetch.at = Date.now();
      for (const doc of r.docs) {
        const id = String(doc.objectID || doc.id || doc.docID || '');
        if (!id) continue;
        state.trackerDocs.set(id, doc);
        indexHit(doc);
      }
      for (const ctl of state.cards.values()) {
        if (ctl.surface !== 'tracker' || ctl.hit) continue;
        ctl.hit = trackerHit(ctl.job);
        if (ctl.hit && !ctl.applyUrl) ctl.applyUrl = ctl.hit.apply_url || null;
        if (ctl.hit) redecorate(ctl);
      }
      scheduleScan();
    } catch { } finally { trackerFetch.inflight = false; }
  }

  function deactivate() {
    resetSynthetic();
    document.querySelectorAll(
      '.hcx-filter-bar, .hcx-digest-btn, .hcx-digest-panel, .hcx-hint, .hcx-help, .hcx-pal, .hcx-note-modal, .hcx-toast-host, .hcx-hide-co-bar'
    ).forEach(e => e.remove());
    for (const ctl of [...state.cards.values()]) {
      ctl.root.querySelectorAll(':scope .hcx-badges, :scope .hcx-actions, :scope .hcx-chip, :scope .hcx-intel')
        .forEach(n => n.remove());
      ctl.root.classList.remove('hcx-card', 'hcx-focus', 'hcx-seen');
      teardown(ctl);
    }
    lastCardSig = '';
  }

  let lastCardSig = '';
  function scan() {

    if (isInternalPage()) { deactivate(); return; }

    const current = findGridCards();
    for (const { slug, root, surface } of current) {
      const existing = root.__hcx;
      if (existing) {
        if (existing.slug === slug) {
          if (!root.querySelector(':scope .hcx-badges')) redecorate(existing);
          continue;
        }
        root.querySelectorAll(':scope .hcx-badges, :scope .hcx-actions, :scope .hcx-chip, :scope .hcx-intel')
          .forEach(n => n.remove());
        teardown(existing);
      }

      const prior = state.cards.get(slug);
      const seed = prior && prior.root !== root ? prior : null;
      if (seed) teardown(seed);
      decorate(slug, root, { surface, seed });
    }
    for (const ctl of [...state.cards.values()]) {
      if (ctl.surface === 'synthetic' || ctl.surface === 'modal' || ctl.surface === 'jobpage') continue;
      if (ctl.surface === 'tracker') { if (!ctl.root.isConnected) teardown(ctl); continue; }
      if (!ctl.root.isConnected) teardown(ctl);
    }

    const drawer = findJobDrawer();
    if (drawer && isHydrated(drawer.jd.root)) {
      const j = { title: drawer.jd.title, company: drawer.jd.company, location: drawer.jd.location };
      const hit = hitForJob(j) || null;
      const slug = 'modal:' + (hit ? (hit.objectID || hit.id) : fingerprint(j) + '|' + normTitle(j.location || ''));
      drawer.dlg.setAttribute('data-hcx-modal', '1');
      ensureDetailSurface(slug, drawer.jd.root, 'modal', {
        job: j, hit,
        applyUrl: hit?.apply_url || null,
        openUrl: drawer.jobPath ? location.origin + drawer.jobPath : (hit?.apply_url || null)
      });
    } else if (drawer) { scheduleScan(250); }

    for (const ctl of [...state.cards.values()]) {
      if (ctl.surface === 'modal' && !ctl.root.isConnected) teardown(ctl);
    }

    const onJobPage = /^\/job\//.test(location.pathname);
    const jp = onJobPage ? findJobPage() : null;
    if (jp && isHydrated(jp.root)) {
      const domJob = { title: jp.title, company: jp.company, location: jp.location };
      const pageHit = jobPageHit();
      const hit = pageHit || hitForJob(domJob) || null;
      const hj = hit ? jobOf(hit) : null;
      const j = hj
        ? { title: hj.title || domJob.title, company: hj.company || domJob.company, location: hj.location || domJob.location }
        : domJob;
      const slug = 'jobpage:' + (hit ? (hit.objectID || hit.id) : fingerprint(j) + '|' + normTitle(j.location || ''));
      ensureDetailSurface(slug, jp.root, 'jobpage', {
        job: j, hit,
        applyUrl: hit?.apply_url || (hit && (hit.applyUrl || hit.applyURL)) || null,
        openUrl: location.href
      });
    } else if (jp) { scheduleScan(250); }
    for (const ctl of [...state.cards.values()]) {
      if (ctl.surface === 'jobpage' && (!ctl.root.isConnected || !onJobPage)) teardown(ctl);
    }
    if (!onJobPage) document.querySelector('.hcx-hide-co-bar')?.remove();

    if (isTrackerView()) ensureTrackerHits();
    for (const { root, surface } of findTrackerCards()) {
      const existing = root.__hcx;
      if (existing) {
        if (!root.querySelector(':scope .hcx-badges')) redecorate(existing);
        continue;
      }
      const job = extractTrackerJob(root);
      if (!job.title || !job.company) continue;
      const hit = trackerHit(job);
      const slug = 'trk:' + (hit ? String(hit.objectID || hit.id) : fingerprint(job) + '|' + normTitle(job.location || ''));
      const prior = state.cards.get(slug);
      if (prior && prior.root !== root) teardown(prior);
      decorate(slug, root, {
        surface, job, hit,
        applyUrl: (hit && hit.apply_url) || null,
        openUrl: hit ? location.origin + (canonicalJobPath(hit) || '/') : undefined,
        seed: prior && prior.root !== root ? prior : undefined
      });
    }

    const sig = [...state.cards.keys()].sort().join('|');
    if (sig !== lastCardSig) {
      lastCardSig = sig;
      for (const fn of HCX.hooks.onCardsChanged) { try { fn(); } catch { } }
    }
    ensureSentinel();
    updatePaginationVisibility();
  }

  function extractJobFromModal(root) {

    let title = '';
    const heads = [...root.querySelectorAll('h1, h2, [class*="text-2xl"], [class*="text-xl"], [class*="font-bold"]')];
    for (const h of heads) { const t = h.textContent.trim(); if (t.length > 3) { title = t; break; } }
    const j = extractJob(root);
    return { title: title || j.title, company: j.company, location: j.location };
  }

  let scanTimer = null;
  function scheduleScan(delay = 180) {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, delay);
  }

  const mo = new MutationObserver(() => scheduleScan());

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      const prev = changes.settings.oldValue || {};
      const next = changes.settings.newValue || {};
      state.settings = { ...DEFAULT_SETTINGS, ...next };
      document.documentElement.classList.toggle('hcx-suppress-popups', !!state.settings.suppressPopups);
      document.documentElement.classList.toggle('hcx-compact', !!state.settings.compactView);
      for (const fn of HCX.hooks.onSettings) { try { fn(); } catch { } }

      const RENDER_KEYS = ['linkedin', 'indeed', 'companyRatings', 'ratingSource', 'companyIntel',
        'atsBadge', 'showNew', 'dimSeen', 'ghostBadge', 'salaryNorm', 'salarySanity', 'layoffFlag', 'trackerStats'];
      if (RENDER_KEYS.some(k => prev[k] !== next[k])) {
        for (const ctl of state.cards.values()) redecorate(ctl);
      }

      if (prev.infiniteScroll !== false && next.infiniteScroll === false) resetSynthetic();
      scan();
    }
    if (changes.blocklists) {
      state.blocklists = { ...DEFAULT_BLOCKLISTS, ...(changes.blocklists.newValue || {}) };
      for (const fn of HCX.hooks.onSettings) { try { fn(); } catch { } }
      scan();
    }
    if (changes.autoHide) {
      state.autoHide = { rules: [], accountWide: false, ...(changes.autoHide.newValue || {}) };
      if (HCX.rebuildAutoHide) HCX.rebuildAutoHide();
      for (const fn of HCX.hooks.onSettings) { try { fn(); } catch { } }
      scan();
    }
    if (changes.layoffsLive) {
      if (D() && D().setLayoffsLive) D().setLayoffsLive(changes.layoffsLive.newValue && changes.layoffsLive.newValue.items || null);
      for (const ctl of state.cards.values()) redecorate(ctl);
    }
    if (changes.marks) { state.marks = changes.marks.newValue || {}; for (const ctl of state.cards.values()) redecorate(ctl); }
    if (changes.notes) { state.notes = changes.notes.newValue || {}; for (const ctl of state.cards.values()) redecorate(ctl); }
    if (changes.seen && changes.seen.newValue === undefined) {
      state.seenSnapshot.clear();
      for (const ctl of state.cards.values()) ctl.root.classList.remove('hcx-seen');
    }
  });

  HCX.boot = async function boot() {
    await loadState();
    try {
      const { layoffsLive } = await api.storage.local.get('layoffsLive');
      if (layoffsLive && layoffsLive.items && D() && D().setLayoffsLive) D().setLayoffsLive(layoffsLive.items);
    } catch { }
    try { api.runtime.sendMessage({ type: 'HCX_LAYOFFS_REFRESH' }).catch(() => { }); } catch { }
    document.documentElement.classList.toggle('hcx-suppress-popups', !!state.settings.suppressPopups);
    document.documentElement.classList.toggle('hcx-compact', !!state.settings.compactView);

    try {
      const nd = JSON.parse(document.getElementById('__NEXT_DATA__').textContent);
      pager.buildId = nd.buildId;
      const pp = nd.props?.pageProps || {};
      pager.searchStateStr = JSON.stringify(pp.initialSearchState || {});
      pager.builtFor = pager.searchStateStr;
      pager.page = pp.ssrPage || 1;
      pager.done = !!pp.ssrIsLastPage;
      pager.enabled = !!pager.buildId && isSearchView();
      for (const h of (pp.ssrHits || [])) indexHit(h);
    } catch { }
    injectBridge();
    window.addEventListener('message', onBridgeMessage);

    for (const fn of (HCX._afterBoot || [])) { try { fn(); } catch { } }
    scan();

    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });

    document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.hcx-card')) scheduleScan(350); }, true);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSeen(); });
    window.addEventListener('pagehide', flushSeen);
  };
  HCX.afterBoot = fn => (HCX._afterBoot = HCX._afterBoot || []).push(fn);
})();
