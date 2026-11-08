const api = globalThis.browser || globalThis.chrome;
const IS_GECKO = typeof globalThis.browser !== 'undefined' && !!globalThis.browser.runtime;
if (typeof importScripts === 'function') importScripts('lib/match.js', 'lib/staticdata.js', 'lib/ratings.js');
const L = globalThis.HCX_LIB;
const R = globalThis.HCX_RATINGS;

const CACHE_TTL_MS = {
  found: 7 * 24 * 3600 * 1000,
  not_found: 12 * 3600 * 1000,
  unknown: 15 * 60 * 1000,
  blocked: 10 * 60 * 1000,
  rate_limited: 10 * 60 * 1000,
  no_tab: 60 * 1000
};
const RATING_TTL_MS = {
  found: 21 * 24 * 3600 * 1000,
  not_found: 3 * 24 * 3600 * 1000,
  unknown: 30 * 60 * 1000,
  blocked: 15 * 60 * 1000
};

function makePool({ concurrency, minGapMs }) {
  const queue = [];
  let active = 0, lastStart = 0, dynGap = minGapMs, dynConc = concurrency, cooldownUntil = 0, okStreak = 0, timer = null;
  function adapt(result) {
    if (result && (result.status === 'rate_limited' || result.status === 'blocked')) {
      dynConc = 1; dynGap = Math.min(dynGap * 2, 8000); cooldownUntil = Date.now() + 4000; okStreak = 0;
    } else {
      okStreak++;
      if (okStreak >= 15) { okStreak = 0; dynGap = Math.max(minGapMs, Math.floor(dynGap / 2)); dynConc = Math.min(concurrency, dynConc + 1); }
    }
  }
  function schedule(wait) { if (timer) return; timer = setTimeout(() => { timer = null; pump(); }, wait); }
  function pump() {
    while (queue.length && active < dynConc) {
      const now = Date.now();
      const wait = Math.max(cooldownUntil - now, lastStart + dynGap - now);
      if (wait > 0) { schedule(wait); return; }
      lastStart = now; active++;
      const { task, resolve } = queue.shift();
      Promise.resolve().then(task).then(
        result => { adapt(result); resolve(result); },
        err => resolve({ status: 'unknown', reason: String(err && err.message || err) })
      ).finally(() => { active--; pump(); });
    }
  }
  return task => new Promise(resolve => { queue.push({ task, resolve }); pump(); });
}

const queues = {
  linkedin: makePool({ concurrency: 4, minGapMs: 150 }),
  indeed: makePool({ concurrency: 3, minGapMs: 250 }),
  rating: makePool({ concurrency: 2, minGapMs: 400 })
};
const inflight = new Map();

function cacheKey(provider, job) {
  return 'c:' + provider + ':' + L.normText(job.title) + '|' + L.normCompany(job.company) + '|' + L.normText(job.location || '');
}
function ratingKey(source, company) { return 'r:' + source + ':' + L.normCompany(company); }
async function getCached(key, ttlMap) {
  const obj = await api.storage.local.get(key);
  const hit = obj[key];
  if (!hit) return null;
  const ttl = ttlMap[hit.status] ?? ttlMap.unknown ?? 900000;
  if (Date.now() - hit.ts > ttl) return null;
  return hit;
}
async function setCached(key, result) { await api.storage.local.set({ [key]: { ...result, ts: Date.now() } }); }
async function bumpStats(provider, status) {
  try {
    const { stats = {} } = await api.storage.local.get('stats');
    stats[provider] = stats[provider] || { checks: 0, found: 0 };
    stats[provider].checks++;
    if (status === 'found') stats[provider].found++;
    await api.storage.local.set({ stats });
  } catch { }
}

async function checkLinkedIn(job) {
  const kw = L.cleanTitle(job.title) + ' ' + job.company;
  const loc = L.simplifyLocation(job.location);
  const url = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=' +
    encodeURIComponent(kw) + '&location=' + encodeURIComponent(loc) + '&start=0';
  let res;
  try { res = await fetch(url, { credentials: 'omit' }); }
  catch (e) { return { status: 'unknown', reason: 'network: ' + e.message }; }
  if (res.status === 429 || res.status === 999) return { status: 'rate_limited' };
  if (!res.ok) return { status: 'unknown', reason: 'HTTP ' + res.status };
  const cards = L.parseLinkedInCards(await res.text());
  const m = L.bestMatch(cards, job);
  return m ? { status: 'found', url: m.url, matchTitle: m.title, matchCompany: m.company } : { status: 'not_found', resultCount: cards.length };
}

async function findTab(pattern) { try { const t = await api.tabs.query({ url: pattern }); return t[0] || null; } catch { return null; } }
const HELPER_WIN_KEY = 'hcxHelperWins';
const HELPER_IDLE_MS = 12000;
let helperIdleTimer = null;

async function trackHelperWindow(winId) {
  try {
    const { [HELPER_WIN_KEY]: ids = [] } = await api.storage.session.get(HELPER_WIN_KEY);
    if (!ids.includes(winId)) { ids.push(winId); await api.storage.session.set({ [HELPER_WIN_KEY]: ids }); }
  } catch { }
}
async function closeHelpers() {
  if (helperIdleTimer) { clearTimeout(helperIdleTimer); helperIdleTimer = null; }
  let ids = [];
  try { ({ [HELPER_WIN_KEY]: ids = [] } = await api.storage.session.get(HELPER_WIN_KEY)); } catch { }
  for (const id of ids) { try { await api.windows.remove(id); } catch { } }
  try { await api.storage.session.remove(HELPER_WIN_KEY); } catch { }
  for (const k of Object.keys(helperVerified)) delete helperVerified[k];
}
function bumpHelperIdle() {
  if (helperIdleTimer) clearTimeout(helperIdleTimer);
  helperIdleTimer = setTimeout(() => { closeHelpers(); }, HELPER_IDLE_MS);
  try { api.alarms.create('hcx-helper-idle', { delayInMinutes: 0.5 }); } catch { }
}

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      try { api.tabs.onUpdated.removeListener(listener); } catch { }
      setTimeout(resolve, 1000);
    };
    function listener(id, info) { if (id === tabId && info.status === 'complete') done(); }
    const to = setTimeout(done, 15000);
    try { api.tabs.onUpdated.addListener(listener); } catch { return done(); }
    api.tabs.get(tabId).then(t => { if (t && t.status === 'complete') done(); }).catch(() => { });
  });
}

async function openHelper(url) {
  let win = null;
  try { win = await api.windows.create({ url, type: 'popup', focused: false, left: -4000, top: -4000, width: 480, height: 360 }); }
  catch { return null; }
  if (!win) return null;
  const tab = win.tabs && win.tabs[0];
  if (!tab) return null;
  trackHelperWindow(win.id);
  try { await api.windows.update(win.id, { state: 'minimized', focused: false }); } catch { }
  await waitForTabLoad(tab.id);
  return tab;
}
async function sendToTab(tab, msg) { try { return await api.tabs.sendMessage(tab.id, msg); } catch { return null; } }

const helperInFlight = {};
const helperVerified = {};
async function tabResponds(tab) {
  try {
    const r = await Promise.race([
      api.tabs.sendMessage(tab.id, { type: 'HCX_PING' }),
      new Promise(res => setTimeout(() => res(null), 2500))
    ]);
    return !!(r && r.pong);
  } catch { return false; }
}
async function ensureHelper(kind) {
  const pat = kind === 'indeed' ? 'https://www.indeed.com/*' : 'https://www.glassdoor.com/*';
  const url = kind === 'indeed' ? 'https://www.indeed.com/' : 'https://www.glassdoor.com/';
  let tabs = [];
  try { tabs = await api.tabs.query({ url: pat }); } catch { }
  for (const t of tabs) if (helperVerified[kind] === t.id) return t;
  for (const t of tabs) if (await tabResponds(t)) { helperVerified[kind] = t.id; return t; }

  if (!helperInFlight[kind]) helperInFlight[kind] = openHelper(url)
    .then(tab => { if (tab) helperVerified[kind] = tab.id; return tab; })
    .finally(() => { helperInFlight[kind] = null; });
  return helperInFlight[kind];
}

async function indeedFetch(url, openTab, raw) {
  let tab = await findTab('https://www.indeed.com/*');
  if (!tab && openTab) tab = await ensureHelper('indeed');
  if (!tab) return null;
  if (openTab) bumpHelperIdle();
  let r = await sendToTab(tab, { type: 'HCX_INDEED_FETCH', url, raw });
  if (!r && openTab) { const fresh = await ensureHelper('indeed'); if (fresh && fresh.id !== tab.id) r = await sendToTab(fresh, { type: 'HCX_INDEED_FETCH', url, raw }); }
  if (openTab) bumpHelperIdle();
  return r;
}
async function glassdoorFetch(url, openTab) {
  let tab = await findTab('https://www.glassdoor.com/*');
  if (!tab && openTab) tab = await ensureHelper('glassdoor');
  if (!tab) return null;
  if (openTab) bumpHelperIdle();
  return await sendToTab(tab, { type: 'HCX_GLASSDOOR_FETCH', url });
}

async function checkIndeed(job, openTab) {
  const q = L.cleanTitle(job.title) + ' ' + job.company;
  const loc = L.indeedLocation(job.location);
  const url = 'https://www.indeed.com/jobs?q=' + encodeURIComponent(q) + '&l=' + encodeURIComponent(loc);
  const viaTab = await indeedFetch(url, openTab, false);
  if (viaTab && !viaTab.error) {
    if (viaTab.challenge) return { status: 'blocked' };
    const cards = viaTab.cards || [];
    const m = L.bestMatch(cards, job);
    if (m) return { status: 'found', url: m.url, matchTitle: m.title, matchCompany: m.company };
    if (cards.length || viaTab.noResults) return { status: 'not_found', resultCount: cards.length };
    return { status: 'unknown', reason: 'unparseable via tab' };
  }
  let res;
  try { res = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html' } }); }
  catch (e) { return { status: 'unknown', reason: 'network: ' + e.message }; }
  const html = res.ok ? await res.text() : '';
  if (L.looksLikeChallenge(html, res.status)) return { status: 'no_tab' };
  const cards = L.parseIndeedCards(html);
  const m = L.bestMatch(cards, job);
  if (m) return { status: 'found', url: m.url, matchTitle: m.title, matchCompany: m.company };
  if (cards.length || L.indeedNoResults(html)) return { status: 'not_found', resultCount: cards.length };
  return { status: 'no_tab' };
}

const providers = { linkedin: checkLinkedIn, indeed: checkIndeed };

async function handleCheck({ provider, job, force, openTab }) {
  const fn = providers[provider];
  if (!fn || !job?.title || !job?.company) return { status: 'unknown', reason: 'bad request' };
  const ckey = cacheKey(provider, job);
  const key = ckey + (force ? ':f' : '');
  if (!force) { const c = await getCached(ckey, CACHE_TTL_MS); if (c) return { ...c, cached: true }; }
  if (inflight.has(key)) return inflight.get(key);
  const p = queues[provider](() => fn(job, openTab)).then(async result => {
    await setCached(ckey, result); await bumpStats(provider, result.status); return result;
  }).catch(e => ({ status: 'unknown', reason: String(e && e.message || e) })).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function ratingOnce(source, company, openTab, force) {
  if (source === 'indeed') return R.indeedCompany(company, url => indeedFetch(url, openTab, true));
  if (source === 'glassdoor') return R.glassdoorCompany(company,
    force ? async url => { try { const res = await fetch(url, { credentials: 'include' }); return { ok: res.ok, status: res.status, text: await res.text() }; } catch { return null; } }
          : async () => null,
    async url => { const r = await glassdoorFetch(url, openTab); return r ? { ok: r.ok, status: r.status, text: r.text, challenge: r.challenge } : null; });
  if (source === 'levels') return R.levelsCompany(company,
    async url => { try { const res = await fetch(url); return { ok: res.ok, status: res.status, text: await res.text() }; } catch { return null; } });
  return { status: 'unknown', source };
}

async function handleRating({ company, source, force, openTab }) {
  if (!company) return { status: 'unknown', reason: 'no company' };
  const wantAll = !source || source === 'auto';
  const order = wantAll ? ['indeed', 'glassdoor', 'levels'] : [source];

  if (!force) {
    for (const src of order) { const c = await getCached(ratingKey(src, company), RATING_TTL_MS); if (c && c.status === 'found') return { ...c, cached: true }; }
  }
  let runnable = order;
  if (!force) {
    let hasIndeed = !!(await findTab('https://www.indeed.com/*'));
    let hasGlassdoor = !!(await findTab('https://www.glassdoor.com/*'));
    const eligible = () => order.filter(src => (src === 'indeed' && hasIndeed) || (src === 'glassdoor' && hasGlassdoor));
    let autoTab = true;
    try { const { settings = {} } = await api.storage.local.get('settings'); autoTab = settings.ratingsAutoTab !== false; } catch { }
    const needed = autoTab ? order.filter(s => (s === 'indeed' && !hasIndeed) || (s === 'glassdoor' && !hasGlassdoor)) : [];
    if (needed.length) {
      const opened = await Promise.all(needed.map(kind => ensureHelper(kind).then(tab => ({ kind, tab }))));
      for (const { kind, tab } of opened) { if (!tab) continue; if (kind === 'indeed') hasIndeed = true; else hasGlassdoor = true; }
      bumpHelperIdle();
    }
    runnable = eligible();
    if (!runnable.length) return { status: 'no_tab' };
  }
  const key = 'rk:' + L.normCompany(company) + ':' + (source || 'auto') + (force ? ':f' : '');
  if (inflight.has(key)) return inflight.get(key);
  const p = queues.rating(async () => {
    for (const src of runnable) {
      if (!force) { const c = await getCached(ratingKey(src, company), RATING_TTL_MS); if (c && c.status !== 'unknown') { if (c.status === 'found') return c; continue; } }
      const res = await ratingOnce(src, company, openTab, force);
      await setCached(ratingKey(src, company), res);
      await bumpStats('rating:' + src, res.status);
      if (res.status === 'found') return res;
    }
    return { status: 'not_found' };
  }).catch(e => ({ status: 'unknown', reason: String(e && e.message || e) })).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function clearCheckCache() {
  const all = await api.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith('c:') || k.startsWith('r:') || k.startsWith('eng:'));
  if (keys.length) await api.storage.local.remove(keys);
  await api.storage.local.remove('stats');
  return { cleared: keys.length };
}

let cachedBuildId = null;
async function getBuildId(force) {
  if (cachedBuildId && !force) return cachedBuildId;
  try {
    const html = await (await fetch('https://hiringcafe.com/', { credentials: 'include' })).text();
    const m = html.match(/"buildId"\s*:\s*"([^"]+)"/);
    if (m) cachedBuildId = m[1];
  } catch { }
  return cachedBuildId;
}
async function pollAlerts() {
  let watches, settings;
  try { ({ alertWatches: watches = [], settings = {} } = await api.storage.local.get(['alertWatches', 'settings'])); } catch { return; }
  if (!watches.length || settings.alerts === false) return;
  let changed = false;
  for (let wi = 0; wi < watches.length; wi++) {
    const w = watches[wi];
    try {
      let bid = await getBuildId(false);
      if (!bid) continue;
      const fetchPage = async id => fetch(`https://hiringcafe.com/_next/data/${id}/index.json?searchState=` + encodeURIComponent(w.state || '{}') + '&page=1', { credentials: 'include' });
      let res = await fetchPage(bid);
      if (res.status === 404) { bid = await getBuildId(true); if (bid) res = await fetchPage(bid); }
      if (!res.ok) continue;
      const hits = ((await res.json()).pageProps?.ssrHits) || [];
      const ids = hits.map(h => String(h.objectID || h.id));
      const known = new Set(w.seen || []);
      const fresh = ids.filter(id => !known.has(id));
      w.seen = [...new Set([...ids, ...(w.seen || [])])].slice(0, 200);
      if (w.initialized && fresh.length) {
        changed = true;
        try {
          const firstTitle = hits.find(h => String(h.objectID || h.id) === fresh[0])?.v5_processed_job_data?.core_job_title || 'New match';
          const opts = {
            type: 'basic', iconUrl: api.runtime.getURL('icons/icon128.png'),
            title: fresh.length + ' new job' + (fresh.length === 1 ? '' : 's') + (w.label ? ' · ' + w.label : ''),
            message: firstTitle + (fresh.length > 1 ? ' and more' : '') + ' on HiringCafe'
          };
          if (!IS_GECKO) opts.priority = 1;
          Promise.resolve(api.notifications.create('hcx-alert-' + wi + '-' + fresh[0], opts)).catch(() => { });
        } catch { }
      }
      w.initialized = true;
      changed = true;
    } catch { }
  }
  if (changed) { try { await api.storage.local.set({ alertWatches: watches }); } catch { } }
}

const LAYOFFS_CSV_URL = 'https://raw.githubusercontent.com/frankwang0909/tech-layoff-tracker/main/data/raw/layoffs_raw.csv';
const LAYOFFS_REFRESH_MS = 20 * 3600e3;

function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function refreshLayoffs(force) {
  try {
    const { layoffsLive } = await api.storage.local.get('layoffsLive');
    if (!force && layoffsLive && Date.now() - (layoffsLive.ts || 0) < LAYOFFS_REFRESH_MS) return { ok: true, cached: true };
    const res = await fetch(LAYOFFS_CSV_URL, { cache: 'no-cache' });
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const rows = parseCSV(await res.text());
    if (rows.length < 2) return { ok: false, error: 'empty csv' };
    const head = rows[0].map(h => h.trim().toLowerCase());
    const iCo = head.indexOf('company'), iN = head.indexOf('num_laid_off'), iDate = head.indexOf('date'),
      iPct = head.indexOf('percentage_laid_off'), iInd = head.indexOf('industry');
    if (iCo < 0 || iDate < 0) return { ok: false, error: 'unexpected csv shape' };
    const byCo = new Map();
    const cutoff = Date.now() - 400 * 86400e3;
    for (const r of rows.slice(1)) {
      const company = (r[iCo] || '').trim();
      const date = (r[iDate] || '').slice(0, 10);
      if (!company || !/^\d{4}-\d{2}/.test(date)) continue;
      if (Date.parse(date) < cutoff) continue;
      const count = Math.round(parseFloat(r[iN]) || 0) || null;
      let pct = parseFloat(r[iPct]);
      pct = isFinite(pct) ? (pct <= 1 ? Math.round(pct * 1000) / 10 : Math.round(pct)) : null;
      if ((count || 0) < 50 && (pct || 0) < 10) continue;
      const month = date.slice(0, 7);
      let entry = byCo.get(company);
      if (!entry) { entry = { company, events: [] }; byCo.set(company, entry); }
      const dupe = entry.events.find(e => e.month === month);
      if (dupe) { if ((count || 0) > (dupe.count || 0)) Object.assign(dupe, { count, pct }); continue; }
      entry.events.push({ month, count, pct, note: (r[iInd] || '').trim() || null });
    }
    if (!byCo.size) return { ok: false, error: 'no rows parsed' };
    await api.storage.local.set({ layoffsLive: { ts: Date.now(), src: 'github:frankwang0909/tech-layoff-tracker', items: [...byCo.values()] } });
    return { ok: true, companies: byCo.size };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

function purgeRemovedFeatureStorage() { try { Promise.resolve(api.storage.local.remove(['ai', 'hcxApplyProfile', 'hcxKnowledge', 'hcxRunActive'])).catch(() => { }); } catch { } }

api.runtime.onInstalled.addListener(() => { try { api.alarms.create('hcx-poll', { periodInMinutes: 30 }); api.alarms.create('hcx-layoffs', { periodInMinutes: 1440 }); } catch { } closeHelpers(); purgeRemovedFeatureStorage(); refreshLayoffs(); });
api.runtime.onStartup?.addListener(() => { try { api.alarms.create('hcx-poll', { periodInMinutes: 30 }); api.alarms.create('hcx-layoffs', { periodInMinutes: 1440 }); } catch { } closeHelpers(); refreshLayoffs(); });
api.alarms?.onAlarm.addListener(a => { if (a.name === 'hcx-poll') pollAlerts(); else if (a.name === 'hcx-helper-idle') closeHelpers(); else if (a.name === 'hcx-layoffs') refreshLayoffs(); });
api.notifications?.onClicked.addListener(id => {
  try {
    Promise.resolve(api.tabs.create({ url: 'https://hiringcafe.com/' })).catch(() => { });
    Promise.resolve(api.notifications.clear(id)).catch(() => { });
  } catch { }
});

async function refreshIdToken(refreshToken, apiKey) {
  const res = await fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(apiKey), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken)
  });
  if (!res.ok) throw new Error('token refresh HTTP ' + res.status);
  const j = await res.json();
  return { token: j.id_token || j.access_token, uid: j.user_id };
}
async function firestoreHide(token, uid, id) {
  const nowISO = new Date().toISOString();
  const name = `projects/hiringcafe-ec4d6/databases/(default)/documents/savedJobs/${uid}_${id}`;
  const body = {
    writes: [{
      update: {
        name,
        fields: {
          objectID: { stringValue: String(id) }, isHidden: { booleanValue: true },
          owner: { stringValue: String(uid) }, dateSaved: { timestampValue: nowISO }, stage: { stringValue: 'hidden' }
        }
      },
      updateMask: { fieldPaths: ['objectID', 'isHidden', 'owner', 'dateSaved', 'stage'] },
      updateTransforms: [{ fieldPath: 'stageHistory', appendMissingElements: { values: [{ mapValue: { fields: { stage: { stringValue: 'hidden' }, at: { timestampValue: nowISO } } } }] } }]
    }]
  };
  const res = await fetch('https://firestore.googleapis.com/v1/projects/hiringcafe-ec4d6/databases/(default)/documents:commit', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('firestore HTTP ' + res.status);
  return true;
}

function fsEncode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  const t = typeof v;
  if (t === 'boolean') return { booleanValue: v };
  if (t === 'number') return Number.isFinite(v) ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : { nullValue: null };
  if (t === 'string') return { stringValue: v };
  if (Array.isArray(v)) { const values = []; for (const it of v) { if (Array.isArray(it)) continue; values.push(fsEncode(it)); } return { arrayValue: { values } }; }
  if (t === 'object') { const fields = {}; for (const k in v) { if (v[k] === undefined || typeof v[k] === 'function') continue; fields[k] = fsEncode(v[k]); } return { mapValue: { fields } }; }
  return { nullValue: null };
}

function fsDecode(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsDecode);
  if ('mapValue' in v) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) out[k] = fsDecode(val);
    return out;
  }
  return null;
}

const TRACKER_STAGES = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'ghosted'];
async function firestoreTracker(token, uid, limit) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'savedJobs' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'owner' }, op: 'EQUAL', value: { stringValue: String(uid) } } },
            { fieldFilter: { field: { fieldPath: 'stage' }, op: 'IN', value: { arrayValue: { values: TRACKER_STAGES.map(s => ({ stringValue: s })) } } } }
          ]
        }
      },
      orderBy: [{ field: { fieldPath: 'dateSaved' }, direction: 'DESCENDING' }],
      limit: Math.min(Math.max(limit || 400, 1), 800)
    }
  };
  const res = await fetch('https://firestore.googleapis.com/v1/projects/hiringcafe-ec4d6/databases/(default)/documents:runQuery', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('firestore HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 160));
  const rows = await res.json();
  const docs = [];
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const d = row && row.document;
    if (!d || !d.fields) continue;
    const doc = {};
    for (const [k, val] of Object.entries(d.fields)) doc[k] = fsDecode(val);
    doc.docID = String(d.name || '').split('/').pop();
    docs.push(doc);
  }
  return docs;
}

async function firestoreSave(token, uid, hit, saveType) {
  const id = String(hit.objectID || hit.id);
  if (!id) throw new Error('job has no id');
  const nowISO = new Date().toISOString();
  const job = { ...hit };
  delete job.voyage_embeddings; delete job.embedding_text_job; delete job._highlightResult; delete job._snippetResult;
  const fields = fsEncode(job).mapValue.fields;
  fields.objectID = { stringValue: id };
  fields.isHidden = { booleanValue: saveType === 'hidden' };
  fields.owner = { stringValue: String(uid) };
  fields.dateSaved = { timestampValue: nowISO };
  fields.stage = { stringValue: saveType };
  const fieldPaths = Object.keys(fields).map(k => '`' + k.replace(/`/g, '\\`') + '`');
  const name = `projects/hiringcafe-ec4d6/databases/(default)/documents/savedJobs/${uid}_${id}`;
  const body = {
    writes: [{
      update: { name, fields },
      updateMask: { fieldPaths },
      updateTransforms: [{ fieldPath: 'stageHistory', appendMissingElements: { values: [{ mapValue: { fields: { stage: { stringValue: saveType }, at: { timestampValue: nowISO } } } }] } }]
    }]
  };
  const res = await fetch('https://firestore.googleapis.com/v1/projects/hiringcafe-ec4d6/databases/(default)/documents:commit', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('firestore HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 160));
  return true;
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const safe = (promise, fallback) => promise.catch(e => fallback(e)).then(sendResponse);
  if (msg?.type === 'HCX_CHECK') { safe(handleCheck(msg), e => ({ status: 'unknown', reason: String(e && e.message || e) })); return true; }
  if (msg?.type === 'HCX_RATING') { safe(handleRating(msg), e => ({ status: 'unknown', reason: String(e && e.message || e) })); return true; }
  if (msg?.type === 'HCX_CLEAR_CACHE') { safe(clearCheckCache(), () => ({ cleared: 0 })); return true; }
  if (msg?.type === 'HCX_POLL_NOW') { safe(pollAlerts().then(() => ({ ok: true })), () => ({ ok: false })); return true; }
  if (msg?.type === 'HCX_REFRESH_TOKEN') { safe(refreshIdToken(msg.refreshToken, msg.apiKey), e => ({ error: String(e && e.message || e) })); return true; }
  if (msg?.type === 'HCX_FS_HIDE') { safe(firestoreHide(msg.token, msg.uid, msg.id).then(() => ({ ok: true })), e => ({ ok: false, error: String(e && e.message || e) })); return true; }
  if (msg?.type === 'HCX_FS_SAVE') { safe(firestoreSave(msg.token, msg.uid, msg.hit, msg.saveType).then(() => ({ ok: true })), e => ({ ok: false, error: String(e && e.message || e) })); return true; }
  if (msg?.type === 'HCX_FS_TRACKER') { safe(firestoreTracker(msg.token, msg.uid, msg.limit).then(docs => ({ ok: true, docs })), e => ({ ok: false, error: String(e && e.message || e) })); return true; }
  if (msg?.type === 'HCX_LAYOFFS_NOW') { safe(refreshLayoffs(true), e => ({ ok: false, error: String(e && e.message || e) })); return true; }
  if (msg?.type === 'HCX_LAYOFFS_REFRESH') { safe(refreshLayoffs(false), e => ({ ok: false, error: String(e && e.message || e) })); return true; }
});
