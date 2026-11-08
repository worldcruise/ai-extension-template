(() => {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const HCX = window.HCX;
  if (!HCX || HCX._featuresLoaded) return;
  HCX._featuresLoaded = true;

  const { state } = HCX;
  const { el, toast, fmtK, fmtEmployees, fmtAgo, normName } = HCX.util;
  const DATA = () => globalThis.HCX_DATA;
  const S = () => state.settings;

  function jobPageHost(root) {
    let host = [...root.children].find(n => n.classList && /flex-wrap/.test(String(n.className)));
    if (!host) { host = el('div', { class: 'hcx-jobpage-pills' }); root.appendChild(host); }
    host.classList.add('hcx-jobpage-host');
    return host;
  }

  function badgeRow(ctl) {
    let row = ctl.root.querySelector(':scope .hcx-badges');
    if (row) return row;
    row = el('span', { class: 'hcx-badges' });
    if (ctl.surface === 'jobpage') {
      row.classList.add('hcx-badges-pills');
      jobPageHost(ctl.root).appendChild(row);
      return row;
    }
    if (ctl.surface === 'modal' || ctl.surface === 'tracker') {

      if (ctl.surface !== 'tracker') {
        const h2 = ctl.root.querySelector('h2.font-extrabold, h2[class*="text-3xl"]');
        let pills = null;
        if (h2) {
          let s = h2.nextElementSibling, hops = 0;
          while (s && hops < 5) {
            if (s.matches && s.matches('div[class*="flex-wrap"]') && s.querySelector('span')) { pills = s; break; }
            s = s.nextElementSibling; hops++;
          }
        }
        if (!pills) pills = ctl.root.querySelector('div[class*="flex-wrap"]');
        if (pills) { row.classList.add('hcx-badges-pills'); pills.appendChild(row); return row; }
      }
      ctl.root.insertBefore(row, ctl.root.firstChild);
      row.classList.add('hcx-badges-block');
      return row;
    }
    const pills = ctl.root.querySelector('div[class*="flex-wrap"]');
    if (pills) pills.appendChild(row);
    else {
      const titleEl = ctl.root.querySelector('span[class*="font-bold"][class*="line-clamp"]');
      (titleEl?.parentElement || ctl.root).appendChild(row);
    }
    return row;
  }

  function gridItemOf(ctl) {
    let e = ctl.root;
    while (e.parentElement) {
      const p = e.parentElement;
      if (p.id === 'hcx-more-grid' || String(p.className).includes('grid-cols')) return e;
      if (p === document.body) return ctl.root;
      e = p;
    }
    return ctl.root;
  }

  function syncCell(ctl) {
    if (ctl.surface === 'jobpage') return;
    const hidden = ['hcx-hidden-collapsed', 'hcx-dupe-collapsed', 'hcx-filtered', 'hcx-blocked']
      .some(c => ctl.root.classList.contains(c));
    const cell = gridItemOf(ctl);
    cell.classList.toggle('hcx-cell-hidden', hidden);
    if (cell !== ctl.root) ctl.root.classList.remove('hcx-cell-hidden');

    if (S().sortMode && S().sortMode !== 'default') cell.style.order = sortRank(ctl);
    else cell.style.order = '';
  }

  const v5Of = ctl => (ctl.hit && ctl.hit.v5_processed_job_data) || {};

  const coOf = ctl => HCX.coData(ctl.hit);

  const PROVIDER_META = {
    linkedin: { label: 'LinkedIn', cls: 'hcx-linkedin' },
    indeed: { label: 'Indeed', cls: 'hcx-indeed' }
  };
  const MARKS_ICON = { checking: '…', found: '✓', not_found: '✗', unknown: '?', blocked: '⛔', rate_limited: '⏳', no_tab: '⛔' };

  function providerSearchUrl(provider, job) {
    const q = encodeURIComponent(job.title + ' ' + job.company);
    const loc = encodeURIComponent(job.location || '');
    return provider === 'linkedin'
      ? `https://www.linkedin.com/jobs/search/?keywords=${q}&location=${loc}`
      : `https://www.indeed.com/jobs?q=${q}&l=${loc}`;
  }

  function providerHost(ctl) {
    const stats = [...ctl.root.querySelectorAll('div[class*="space-x-6"]')]
      .find(d => /\bviews?\b/i.test(d.textContent) && d.querySelector('svg'));
    if (stats) {
      let host = stats.querySelector(':scope > .hcx-badges');
      if (!host) { host = el('span', { class: 'hcx-badges hcx-badges-footer' }); stats.appendChild(host); }
      return host;
    }
    return badgeRow(ctl);
  }

  function renderProviderBadge(ctl, provider, result) {
    const meta = PROVIDER_META[provider];
    const row = providerHost(ctl);
    let b = row.querySelector(':scope .' + meta.cls);
    if (!b) {
      b = el('button', {
        type: 'button', class: 'hcx-badge ' + meta.cls,
        onclick: e => { e.preventDefault(); e.stopPropagation(); onProviderClick(ctl, provider); }
      });
      row.appendChild(b);
    }
    const st = result?.status || 'checking';
    b.dataset.state = st;
    ctl.results[provider] = result || null;
    b.textContent = '';
    b.append(el('span', { class: 'hcx-lab', text: meta.label }), el('span', { class: 'hcx-mark', text: MARKS_ICON[st] || '?' }));
    b.title = providerTooltip(provider, result, ctl.job);
    applyFilter(ctl);
    scheduleCounts();
  }

  function providerTooltip(provider, result, job) {
    const name = PROVIDER_META[provider].label;
    switch (result?.status) {
      case 'found': return `On ${name}: "${result.matchTitle}" @ ${result.matchCompany} — click to open`;
      case 'not_found': return `Not found on ${name} — click to search`;
      case 'blocked': case 'no_tab': return `${name} needs an open ${provider}.com tab. Click to open one & retry.`;
      case 'rate_limited': return `${name} is rate-limiting. Click to retry.`;
      case 'unknown': return `Couldn't check ${name} (${result?.reason || 'error'}). Click to retry.`;
      default: return `Checking ${name}…`;
    }
  }

  function onProviderClick(ctl, provider) {
    const r = ctl.results[provider];
    if (r?.status === 'found') window.open(r.url, '_blank', 'noopener');
    else if (r?.status === 'not_found') window.open(providerSearchUrl(provider, ctl.job), '_blank', 'noopener');
    else {
      const openTab = provider === 'indeed' && (r?.status === 'no_tab' || r?.status === 'blocked');
      runCheck(ctl, provider, true, openTab);
    }
  }

  async function runCheck(ctl, provider, force = false, openTab = false) {
    if (!S()[provider]) return;
    if (!ctl.job.title || !ctl.job.company) { renderProviderBadge(ctl, provider, { status: 'unknown', reason: "couldn't read card" }); return; }
    if (!force && ctl.dispatched[provider]) return;
    ctl.dispatched[provider] = true;
    renderProviderBadge(ctl, provider, { status: 'checking' });
    let result;
    try {
      result = await Promise.race([
        api.runtime.sendMessage({ type: 'HCX_CHECK', provider, job: ctl.job, force, openTab }),
        new Promise(r => setTimeout(() => r({ status: 'unknown', reason: 'timeout' }), HCX.consts.CHECK_TIMEOUT))
      ]);
    } catch (e) { result = { status: 'unknown', reason: String(e && e.message || e) }; }
    if (!result) result = { status: 'unknown', reason: 'no response' };

    if (!ctl.root.isConnected || ctl.root.__hcx !== ctl) return;
    renderProviderBadge(ctl, provider, result);

    if (provider === 'indeed' && ['no_tab', 'blocked', 'unknown'].includes(result.status)) {
      ctl.indeedRetries = ctl.indeedRetries || 0;
      if (ctl.indeedRetries < 2) {
        ctl.indeedRetries++;
        setTimeout(() => { if (ctl.root.isConnected && ctl.root.__hcx === ctl && S().indeed) runCheck(ctl, 'indeed', true, true); }, 3000);
      }
    }
  }

  function renderRating(ctl, result) {
    if (!S().companyRatings) return;
    const row = badgeRow(ctl);
    let b = row.querySelector(':scope .hcx-rating');
    if (!b) {
      b = el('button', { type: 'button', class: 'hcx-badge hcx-rating', onclick: e => { e.preventDefault(); e.stopPropagation(); onRatingClick(ctl); } });
      row.appendChild(b);
    }
    ctl.rating = result || null;
    const st = result?.status;
    b.dataset.state = st || 'checking';
    b.textContent = '';
    if (st === 'found' && result.rating != null) {
      const src = result.source === 'glassdoor' ? 'GD' : result.source === 'indeed' ? 'IN' : result.source === 'levels' ? 'L' : '★';
      b.append(el('span', { class: 'hcx-mark', text: '★ ' + result.rating.toFixed(1) }), el('span', { class: 'hcx-lab', text: src + (result.count ? ' · ' + compact(result.count) : '') }));
      b.dataset.tier = result.rating >= 4 ? 'good' : result.rating >= 3 ? 'ok' : 'bad';
      b.title = `${result.source} rating ${result.rating}${result.count ? ' from ' + result.count + ' reviews' : ''} — click to open`;
    } else if (st === 'checking' || !st) {
      b.append(el('span', { class: 'hcx-mark', text: '★' }), el('span', { class: 'hcx-lab', text: '…' }));
      b.title = 'Checking company rating…';
    } else {
      b.append(el('span', { class: 'hcx-mark', text: '★' }), el('span', { class: 'hcx-lab', text: '–' }));
      b.title = 'No rating found — click to retry';
    }
    applyFilter(ctl);
    scheduleCounts();
  }

  function compact(n) { return n >= 1000 ? Math.round(n / 100) / 10 + 'k' : String(n); }

  function onRatingClick(ctl) {
    const r = ctl.rating;
    if (r?.status === 'found' && r.url) window.open(r.url, '_blank', 'noopener');
    else runRating(ctl, true, true);
  }

  async function runRating(ctl, force = false, openTab = false) {
    if (!S().companyRatings || !ctl.job.company) return;
    if (!force && ctl.dispatched.rating) return;
    ctl.dispatched.rating = true;
    renderRating(ctl, { status: 'checking' });
    let result;
    try {
      result = await Promise.race([
        api.runtime.sendMessage({ type: 'HCX_RATING', company: ctl.job.company, source: S().ratingSource, force, openTab }),
        new Promise(r => setTimeout(() => r({ status: 'unknown' }), HCX.consts.CHECK_TIMEOUT))
      ]);
    } catch (e) { result = { status: 'unknown', reason: String(e && e.message || e) }; }
    if (!ctl.root.isConnected || ctl.root.__hcx !== ctl) return;
    renderRating(ctl, result || { status: 'unknown' });

    if (result && result.status !== 'found') {
      ctl.ratingRetries = ctl.ratingRetries || 0;
      if (ctl.ratingRetries < 2 && ['no_tab', 'unknown', 'blocked', 'not_found'].includes(result.status)) {
        ctl.ratingRetries++;
        setTimeout(() => { if (ctl.root.isConnected && ctl.root.__hcx === ctl && S().companyRatings) runRating(ctl, true, true); }, 3000);
      }
    }
  }

  const warmedGroups = new Set();
  function warmGroup(ctl) {
    const ck = ctl.hit && ctl.hit.collapse_key;
    if (!ck || warmedGroups.has(ck)) return;
    const hits = HCX.data.groupHits(ck);
    if (hits.length <= 1) return;
    warmedGroups.add(ck);
    for (const hit of hits) {
      const v5 = hit.v5_processed_job_data || {}, co = hit.enriched_company_data || {};
      const job = { title: v5.core_job_title || hit.job_information?.title || '', company: v5.company_name || co.name || '', location: v5.formatted_workplace_location || '' };
      if (!job.title || !job.company) continue;
      try {
        if (S().linkedin) api.runtime.sendMessage({ type: 'HCX_CHECK', provider: 'linkedin', job }).catch(() => { });
        if (S().indeed) api.runtime.sendMessage({ type: 'HCX_CHECK', provider: 'indeed', job }).catch(() => { });
        if (S().companyRatings) api.runtime.sendMessage({ type: 'HCX_RATING', company: job.company, source: S().ratingSource }).catch(() => { });
      } catch { }
    }
  }

  function engValues(hit) {
    const ji = (hit && hit.job_information) || {};
    const saves = (ji.savedFromUsers || []).length;
    const apps = (ji.appliedFromUsers || []).length;
    const views = Math.max((ji.viewedByUsers || []).length, saves, apps) + 1;
    return { views, saves, apps };
  }
  function fmtNum(n) {
    if (!n) return '0';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }

  const engInflight = new Map();
  const ENG_TTL = 12 * 3600e3;
  async function fetchEngagement(hit) {
    const id = String(hit.objectID || hit.id || '');
    if (!id) return null;
    if (engInflight.has(id)) return engInflight.get(id);
    const p = (async () => {
      const key = 'eng:' + id;
      try {
        const { [key]: cached } = await api.storage.local.get(key);
        if (cached && Date.now() - cached.ts < ENG_TTL) return cached;
      } catch { }
      const bid = HCX.pager.buildId;
      const path = HCX.canonicalJobPath ? HCX.canonicalJobPath(hit) : null;
      if (!bid || !path) return null;
      const load = async seg => {
        const res = await fetch(`${location.origin}/_next/data/${bid}/job/${seg}.json?requisitionId=${seg}`, { credentials: 'include' });
        if (!res.ok) return null;
        return (await res.json()).pageProps || null;
      };
      try {
        let pp = await load(path.slice('/job/'.length));
        if (pp && pp.__N_REDIRECT) pp = await load(String(pp.__N_REDIRECT).split('?')[0].split('/').pop());
        if (!pp || !pp.job) return null;
        const v = { ...engValues(pp.job), ts: Date.now() };
        try { await api.storage.local.set({ [key]: v }); } catch { }
        return v;
      } catch { return null; }
    })().finally(() => setTimeout(() => engInflight.delete(id), 60000));
    engInflight.set(id, p);
    return p;
  }

  function renderTrackerStats(ctl) {
    if (ctl.surface !== 'tracker') return;
    ctl.root.querySelector(':scope .hcx-trk-stats')?.remove();
    if (!S().trackerStats || !ctl.hit) return;
    const row = el('div', { class: 'hcx-trk-stats', title: 'Views / saves / applications — HiringCafe+' });
    const mk = (icon, val, label) => el('span', { class: 'hcx-trk-stat' },
      HCX.util.synIcon(icon, 'hcx-trk-ico'), el('span', { class: 'hcx-trk-num', text: fmtNum(val) }), el('span', { text: label }));
    const draw = v => { row.textContent = ''; row.append(mk('eye', v.views, 'views'), mk('save', v.saves, 'saves'), mk('plane', v.apps, 'applications')); };
    draw(engValues(ctl.hit));
    const footer = ctl.root.querySelector(':scope > div[class*="border-t"]');
    if (footer) footer.insertAdjacentElement('beforebegin', row);
    else ctl.root.appendChild(row);
    fetchEngagement(ctl.hit).then(v => {
      if (!v || !row.isConnected) return;
      draw(v);
      row.title = 'Views / saves / applications — refreshed from HiringCafe';
    });
  }

  HCX.engValues = engValues;
  HCX.fmtEngNum = fmtNum;

  function layoffOf(ctl) {
    const d = DATA();
    return d && d.layoffInfo ? d.layoffInfo(ctl.job.company) : null;
  }
  function renderLayoffs(ctl) {
    const row = badgeRow(ctl);
    row.querySelector(':scope .hcx-layoff')?.remove();
    if (!S().layoffFlag) return;
    const info = layoffOf(ctl);
    if (!info) return;
    row.appendChild(el('span', { class: 'hcx-sig hcx-layoff', text: '📉 layoffs', title: info.tip }));
  }

  function renderNew(ctl) {
    if (ctl.surface === 'tracker') return;
    if (!S().showNew || state.seenSnapshot.has(ctl.slug)) return;
    const row = badgeRow(ctl);
    if (row.querySelector(':scope .hcx-new')) return;
    row.prepend(el('span', { class: 'hcx-new', text: 'NEW' }));
  }

  function renderIntel(ctl) {
    ctl.root.querySelector(':scope .hcx-intel')?.remove();
    if (!S().companyIntel || !ctl.hit) return;
    const co = coOf(ctl);
    const chips = [];
    if (co.nb_employees) chips.push(['👥 ' + fmtEmployees(co.nb_employees), 'Company size']);
    if (co.year_founded) chips.push(['🏛 ' + co.year_founded, 'Founded']);
    if (co.organization_type && /public|private|government|non/i.test(co.organization_type)) chips.push([co.organization_type.replace(/_/g, ' '), 'Org type']);
    if (co.stock_symbol) chips.push(['📈 ' + co.stock_symbol, (co.stock_exchange || '') + ' ' + co.stock_symbol]);
    if (co.latest_funding_type) chips.push(['💰 ' + co.latest_funding_type + (co.latest_funding_year ? ' ’' + String(co.latest_funding_year).slice(2) : ''), 'Latest funding']);
    if (Array.isArray(co.industries) && co.industries[0]) chips.push(['🏷 ' + co.industries[0], (co.industries || []).join(', ')]);
    if (!chips.length) return;
    const wrap = el('div', { class: 'hcx-intel' });
    for (const [txt, tip] of chips.slice(0, 5)) wrap.appendChild(el('span', { class: 'hcx-intel-chip', title: tip, text: txt }));
    badgeRow(ctl).insertAdjacentElement('afterend', wrap);
  }

  function renderATS(ctl) {
    const row = badgeRow(ctl);
    row.querySelector(':scope .hcx-ats')?.remove();
    const url = ctl.applyUrl || (ctl.hit && ctl.hit.apply_url);

    const ats = DATA() && url ? DATA().atsInfo(url) : (ctl.hit && ctl.hit.source ? DATA()?.atsBySource(ctl.hit.source) : null);
    if (S().atsBadge && ats) {
      row.appendChild(el('span', { class: 'hcx-ats', dataset: { fr: ats.friendliness }, title: ats.name + ' — ' + ats.friendliness + ' application', text: '⚙ ' + ats.name }));
    }
    ctl.ats = ats;
  }

  const YEARLY_MULT = { hr: 2080, day: 260, wk: 52, mo: 12, yr: 1 };
  function renderSalary(ctl) {
    ctl.root.querySelector(':scope .hcx-salary')?.remove();
    ctl.root.querySelector(':scope .hcx-salary-flag')?.remove();
    if (!S().salaryNorm && !S().salarySanity) return;
    const v5 = v5Of(ctl);

    if (S().salarySanity && v5.yearly_min_compensation && v5.yearly_max_compensation) {
      const lo = v5.yearly_min_compensation, hi = v5.yearly_max_compensation;
      if (hi > lo * 2.5 && (hi - lo) > 60000) {
        badgeRow(ctl).appendChild(el('span', { class: 'hcx-salary-flag', title: `Suspiciously wide range: ${fmtK(lo)}–${fmtK(hi)}`, text: '⚠ wide $' }));
      }
    }

    if (!S().salaryNorm) return;
    const pills = ctl.surface === 'jobpage' ? jobPageHost(ctl.root) : ctl.root.querySelector('div[class*="flex-wrap"]');
    if (!pills) return;
    for (const sp of pills.querySelectorAll('span')) {
      if (sp.closest('.hcx-badges') || sp.classList.contains('hcx-salary')) continue;
      const s = parseSalaryText(sp.textContent || '');
      if (!s || s.unit === 'yr') continue;
      const f = YEARLY_MULT[s.unit]; if (!f) continue;
      const lo = s.lo * f, hi = s.hi * f;
      const tag = el('span', { class: 'hcx-salary', title: 'Yearly equivalent — HiringCafe+', text: '≈ ' + fmtK(lo) + (hi !== lo ? '–' + fmtK(hi) : '') + '/yr' });
      sp.insertAdjacentElement('afterend', tag);
      break;
    }
  }
  function parseSalaryText(txt) {
    const m = String(txt).trim().match(/^\$([\d,.]+)(k)?(?:\s*[-–]\s*\$([\d,.]+)(k)?)?\s*\/\s*(hr|yr|mo|wk|day)\b/i);
    if (!m) return null;
    const num = (v, k) => { let n = parseFloat(v.replace(/,/g, '')); if (k) n *= 1000; return n; };
    const lo = num(m[1], m[2]); const hi = m[3] ? num(m[3], m[4]) : lo;
    return { lo, hi, unit: m[5].toLowerCase() };
  }

  function renderSignals(ctl) {
    const row = badgeRow(ctl);
    row.querySelectorAll(':scope .hcx-sig').forEach(n => n.remove());
    const v5 = v5Of(ctl);
    const add = (txt, cls, tip) => row.appendChild(el('span', { class: 'hcx-sig ' + cls, title: tip, text: txt }));

    if (ctl.hit) {
      if (v5.visa_sponsorship === true) add('🛂 visa', 'hcx-sig-good', 'Offers visa sponsorship');
      else if (v5.visa_sponsorship === false) add('🚫 visa', 'hcx-sig-bad', 'No visa sponsorship');
      if (v5.security_clearance && !/none|not/i.test(String(v5.security_clearance))) add('🔒 clearance', 'hcx-sig-warn', 'Requires: ' + v5.security_clearance);

      const nStates = v5.number_of_workplace_states;
      if (/remote/i.test(v5.workplace_type || '') || v5.is_workplace_worldwide_ok) {
        if (v5.is_workplace_worldwide_ok) add('🌍 worldwide', 'hcx-sig-good', 'Remote — worldwide OK');
        else if (nStates && nStates > 0 && nStates < 50) add('📍 ' + nStates + ' states', 'hcx-sig-warn', 'Remote but restricted to ' + nStates + ' state(s): ' + (v5.workplace_states || []).join(', '));
      }
      const benefits = [];
      if (v5['401k_matching']) benefits.push('401k');
      if (v5.four_day_work_week) benefits.push('4-day wk');
      if (v5.generous_parental_leave) benefits.push('parental');
      if (v5.tuition_reimbursement) benefits.push('tuition');
      if (v5.military_veterans) benefits.push('veterans');
      if (benefits.length) add('✨ ' + benefits.slice(0, 2).join(', '), 'hcx-sig-good', 'Perks: ' + benefits.join(', '));
    }

    if (S().ghostBadge) {
      const ms = v5.estimated_publish_date_millis || (v5.estimated_publish_date ? Date.parse(v5.estimated_publish_date) : null);
      const ageDays = ms ? Math.floor((Date.now() - ms) / 86400000) : null;
      if (ageDays != null && ageDays >= HCX.consts.GHOST_AGE_DAYS) add('👻 ' + fmtAgo(ms), 'hcx-sig-warn', `Posted ${ageDays}d ago — may be stale/reposted`);
      else if (ms) { const age = fmtAgo(ms); if (age) add('🕐 ' + age, 'hcx-sig-muted', 'Posted ' + age + ' ago'); }
    }
  }

  const MARK_META = { a: { cls: 'hcx-marked-a', chip: '✓ APPLIED' } };

  function applyMarkStyles(ctl) {
    const mark = state.marks[ctl.slug]?.s;
    for (const m of Object.values(MARK_META)) ctl.root.classList.remove(m.cls);
    ctl.root.querySelector(':scope .hcx-chip')?.remove();
    if (!mark || !MARK_META[mark]) { syncCell(ctl); return; }
    ctl.root.classList.add(MARK_META[mark].cls);
    const chip = el('span', { class: 'hcx-chip hcx-chip-' + mark, text: MARK_META[mark].chip });
    (ctl.surface === 'jobpage' ? badgeRow(ctl) : ctl.root).appendChild(chip);
    syncCell(ctl);
  }

  function setMark(ctl, s) {
    if (s && s !== 'a') return;
    const cur = state.marks[ctl.slug]?.s;
    if (cur === s || s === null) delete state.marks[ctl.slug];
    else state.marks[ctl.slug] = { s, t: Date.now(), title: ctl.job.title, company: ctl.job.company, location: ctl.job.location, url: ctl.applyUrl || ctl.openUrl };
    HCX.storage.saveMarks();
    applyMarkStyles(ctl);
    updateDigest();
  }
  HCX.setMark = setMark;

  const REPORT_REASONS = [
    ['fake', 'Fake / scam / spam'],
    ['thirdparty', 'Third-party recruiter / agency'],
    ['reposted', 'Reposted job'],
    ['outdated', 'Expired / closed'],
    ['incorrect', 'Incorrect job info']
  ];
  function reportJob(ctl, reason) {
    const id = ctl.hit && (ctl.hit.objectID || ctl.hit.id);
    if (!id) { toast('Can’t report — job id unavailable'); return; }
    fetch(location.origin + '/api/marketplaceFunctions/reportJob', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ job_id: id, reason })
    }).then(r => toast(r.ok ? '🚩 Reported — thanks' : 'Report failed (' + r.status + ')'))
      .catch(() => toast('Report failed'));
  }
  function openReportMenu(ctl, anchor) {
    document.querySelector('.hcx-report-menu')?.remove();
    const menu = el('div', { class: 'hcx-report-menu' }, el('div', { class: 'hcx-report-head', text: 'Report this job' }));
    for (const [val, label] of REPORT_REASONS) {
      menu.appendChild(el('button', { type: 'button', class: 'hcx-report-item', text: label, onclick: e => { e.preventDefault(); e.stopPropagation(); reportJob(ctl, val); menu.remove(); } }));
    }
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = (window.scrollX + Math.max(6, Math.min(innerWidth - menu.offsetWidth - 6, r.left - menu.offsetWidth + r.width))) + 'px';
    menu.style.top = (r.bottom + 4 + window.scrollY) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function close(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', close); } }), 0);
  }
  HCX.reportFocused = ctl => { const bar = ctl.root.querySelector(':scope .hcx-report-btn'); openReportMenu(ctl, bar || ctl.root); };

  async function blockCompanyForever(ctl) {
    const co = ctl.job.company;
    if (!co) { toast('No company on this card'); return; }
    if (companyHiddenNow(co)) { toast(co + ' is already hidden'); return; }
    if (!HCX.confirmModal || !HCX.hideCompanyForever) return;
    const ok = await HCX.confirmModal(
      'Hide every job from “' + co + '”, now and in future searches? This saves a permanent company rule in your ⚙ Filters, where you can remove it any time.',
      { title: '🚫 Hide this company', ok: 'Hide ' + co, danger: true });
    if (!ok) return;
    if (!await HCX.hideCompanyForever(co, true)) { toast('Could not update your filters'); return; }
    applyFilterAll();
    refreshHideCompany();
    toast('🚫 ' + co + ' hidden everywhere', { action: { label: 'Undo', fn: async () => { await HCX.hideCompanyForever(co, false); applyFilterAll(); refreshHideCompany(); } } });
  }

  function addActionBar(ctl) {
    if (ctl.root.querySelector(':scope .hcx-actions')) return;
    const bar = el('div', { class: 'hcx-actions' });

    const cur = () => ctl.root.__hcx || ctl;
    bar.append(
      el('button', { type: 'button', title: 'Applied (a)', text: '✓', onclick: e => { e.preventDefault(); e.stopPropagation(); setMark(cur(), 'a'); } }),
      el('button', { type: 'button', class: 'hcx-report-btn', title: 'Report job (r)', text: '🚩', onclick: e => { e.preventDefault(); e.stopPropagation(); openReportMenu(cur(), e.currentTarget); } }),
      el('button', { type: 'button', class: 'hcx-note-btn', title: 'Note (n)', text: state.notes[ctl.slug] ? '📝' : '🗒', onclick: e => { e.preventDefault(); e.stopPropagation(); HCX.editNote && HCX.editNote(cur()); } }),
      el('button', { type: 'button', class: 'hcx-block-btn', title: 'Never show this company again', text: '🚫', onclick: e => { e.preventDefault(); e.stopPropagation(); blockCompanyForever(cur()); } })
    );
    if (ctl.surface === 'jobpage') jobPageHost(ctl.root).appendChild(bar);
    else ctl.root.appendChild(bar);
  }

  function companyHiddenNow(name) {
    const co = String(name || '').trim().toLowerCase();
    if (!co) return false;
    for (const r of (state.autoHide.rules || [])) {
      const m = String(r).match(/^\s*company\s*:\s*(.+)$/i);
      if (m && m[1].trim().toLowerCase() === co) return true;
    }
    return (state.blocklists.companies || []).some(c => String(c).trim().toLowerCase() === co);
  }

  let hideCoBar = null;
  function renderHideCompany(ctl) {
    if (ctl.surface !== 'jobpage') return;
    const co = ctl.job.company;
    const main = document.querySelector('main');
    if (!co || !main) { hideCoBar?.remove(); hideCoBar = null; return; }
    if (!hideCoBar || !hideCoBar.isConnected) {
      hideCoBar = el('div', { class: 'hcx-hide-co-bar' });
      const nav = [...main.children].reverse().find(n => n.tagName === 'NAV');
      if (nav) main.insertBefore(hideCoBar, nav); else main.appendChild(hideCoBar);
    }
    const on = companyHiddenNow(co);
    hideCoBar.textContent = '';
    const btn = el('button', {
      type: 'button', class: 'hcx-hide-co' + (on ? ' hcx-hide-co-on' : ''),
      title: on ? 'Remove ' + co + ' from your filters' : 'Never show jobs from ' + co + ' again',
      text: on ? '✓ ' + co + ' is hidden — click to unhide' : '🚫 Never show jobs from ' + co,
      onclick: async () => {
        btn.disabled = true;
        const ok = HCX.hideCompanyForever ? await HCX.hideCompanyForever(co, !on) : false;
        btn.disabled = false;
        if (!ok) { toast('Could not update your filters'); return; }
        renderHideCompany(ctl);
        applyFilterAll();
        if (on) toast(co + ' unhidden');
        else toast('🚫 ' + co + ' hidden everywhere', { action: { label: 'Undo', fn: async () => { await HCX.hideCompanyForever(co, false); renderHideCompany(ctl); applyFilterAll(); } } });
      }
    });
    hideCoBar.append(btn, el('div', {
      class: 'hcx-hide-co-note',
      text: on ? 'Saved in ⚙ Filters — jobs from this company stay hidden from your search results.'
        : 'Adds a permanent company rule to ⚙ Filters, applied to every search from now on.'
    }));
  }
  HCX.renderHideCompany = renderHideCompany;

  function renderNoteIndicator(ctl) {
    const has = !!state.notes[ctl.slug];
    ctl.root.classList.toggle('hcx-has-note', has);
    const nb = ctl.root.querySelector(':scope .hcx-note-btn');
    if (nb) nb.textContent = has ? '📝' : '🗒';
  }

  function isAICompanyJob(ctl) {
    const d = DATA();
    if (d && d.isAICompany && d.isAICompany(ctl.job.company)) return true;
    const co = coOf(ctl);
    const home = String(co.homepage_uri || '').toLowerCase();
    if (/\.ai(\b|\/|$)/.test(home)) return true;
    const inds = co.industries;
    const indStr = (Array.isArray(inds) ? inds.join(' ') : String(inds || '')).toLowerCase();
    return /artificial intelligence|machine learning|generative ai/.test(indStr);
  }
  const NUM_GET = {
    size: ctl => coOf(ctl).nb_employees,
    yoe: ctl => v5Of(ctl).min_industry_and_role_yoe,
    founded: ctl => coOf(ctl).year_founded
  };

  let autoHidePreds = [];
  function parseAutoHideRule(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s || s.startsWith('#')) return null;
    let m;
    if ((m = s.match(/salary\s*(<|>|=)\s*\$?\s*([\d.,]+)\s*(k)?/))) {
      let n = parseFloat(m[2].replace(/,/g, '')); if (m[3]) n *= 1000; const op = m[1];
      return ctl => {
        const v5 = v5Of(ctl), max = v5.yearly_max_compensation, min = v5.yearly_min_compensation;
        if (op === '<') { const v = max || min; return !!v && v < n; }
        if (op === '>') { const v = min || max; return !!v && v > n; }
        const lo = min || max, hi = max || min; return !!lo && !!hi && n >= lo && n <= hi;
      };
    }
    if ((m = s.match(/^(size|employees|yoe|experience|founded)\s*(<|>|=)\s*([\d.,]+)\s*(k)?/))) {
      const fk = m[1] === 'employees' ? 'size' : m[1] === 'experience' ? 'yoe' : m[1];
      let n = parseFloat(m[3].replace(/,/g, '')); if (m[4]) n *= 1000; const op = m[2], get = NUM_GET[fk];
      return ctl => { const raw = get(ctl); const v = Number(raw); if (raw == null || raw === '' || !isFinite(v)) return false; return op === '<' ? v < n : op === '>' ? v > n : v === n; };
    }
    if (/^ai[\s-]+(compan(y|ies)|based|first)\b|artificial intelligence/.test(s)) return ctl => isAICompanyJob(ctl);
    if (/(^|\W)no\s*visa|visa\s*:?\s*(no|false)|no\s*sponsor/.test(s)) return ctl => v5Of(ctl).visa_sponsorship === false;
    if (/clearance/.test(s)) return ctl => { const c = v5Of(ctl).security_clearance; return !!c && !/none|not/i.test(String(c)); };
    if (/agency|staffing|recruiter/.test(s)) return ctl => !!(DATA() && DATA().isAgency(ctl.job.company));
    if (/\bmlm\b/.test(s)) return ctl => !!(DATA() && DATA().isMLM(ctl.job.company));
    if (/layoff/.test(s)) return ctl => !!layoffOf(ctl);
    if (/stale|reposted|\bold(er)?\b/.test(s)) return ctl => { const ms = v5Of(ctl).estimated_publish_date_millis; return !!ms && (Date.now() - ms) / 864e5 >= HCX.consts.GHOST_AGE_DAYS; };
    if (/not\s*remote|onsite\s*only|no\s*remote/.test(s)) return ctl => !/remote/i.test(v5Of(ctl).workplace_type || '');
    if ((m = s.match(/^ats\s*:?\s*(.+)/))) { const t = m[1].trim(); return ctl => { const a = ctl.ats; return !!a && (a.key === t || a.name.toLowerCase() === t || a.friendliness === t || a.name.toLowerCase().includes(t)); }; }
    if ((m = s.match(/^(title|company|location)\s*(?:contains\s*)?:?\s*(.+)/))) { const f = m[1], val = m[2].trim(); return ctl => ((f === 'title' ? ctl.job.title : f === 'company' ? ctl.job.company : ctl.job.location) || '').toLowerCase().includes(val); }
    const kw = s.replace(/^keyword\s*:?\s*/, '');
    return ctl => (ctl.job.title + ' ' + ctl.job.company).toLowerCase().includes(kw);
  }
  function rebuildAutoHide() { autoHidePreds = (state.autoHide.rules || []).map(parseAutoHideRule).filter(Boolean); }
  function matchesAutoHide(ctl) { for (const p of autoHidePreds) { try { if (p(ctl)) return true; } catch { } } return false; }
  HCX.rebuildAutoHide = rebuildAutoHide;
  HCX.matchesAutoHide = matchesAutoHide;

  function isBlocked(ctl) {
    const bl = state.blocklists, d = DATA();
    const co = normName(ctl.job.company), title = (ctl.job.title || '').toLowerCase(), loc = (ctl.job.location || '').toLowerCase();
    if (matchesAutoHide(ctl)) return true;
    if (bl.companies?.some(c => { const n = normName(c); return n && (co === n || co.includes(n)); })) return true;
    if (bl.keywords?.some(k => { const s = k.toLowerCase().trim(); return s && (title.includes(s) || co.includes(normName(s))); })) return true;
    if (bl.locations?.some(l => { const s = l.toLowerCase().trim(); return s && loc.includes(s); })) return true;
    if (bl.ats?.length && ctl.ats && bl.ats.includes(ctl.ats.key)) return true;
    if (bl.useAgencies && d && d.isAgency(ctl.job.company)) return true;
    if (bl.useMLM && d && d.isMLM(ctl.job.company)) return true;
    return false;
  }

  function cardMatchesFilter(ctl) {
    const li = ctl.results.linkedin?.status, ind = ctl.results.indeed?.status;
    switch (S().filterMode) {
      case 'not_linkedin': return li !== 'found';
      case 'not_indeed': return ind !== 'found';
      case 'neither': return li !== 'found' && ind !== 'found';
      default: return true;
    }
  }

  function applyFilter(ctl) {
    if (ctl.surface === 'jobpage' || ctl.surface === 'tracker') return;
    const blocked = isBlocked(ctl);
    ctl.root.classList.toggle('hcx-blocked', blocked);
    ctl.root.classList.toggle('hcx-filtered', !blocked && !cardMatchesFilter(ctl));
    syncCell(ctl);
  }
  function applyFilterAll() { for (const ctl of state.cards.values()) applyFilter(ctl); updateFilterBar(); updateDigest(); }

  function sortRank(ctl) {
    const v5 = v5Of(ctl);
    switch (S().sortMode) {
      case 'rating': return Math.round((5 - (ctl.rating?.rating ?? 0)) * 1000);
      case 'salary_desc': return Math.round(1e7 - (v5.yearly_max_compensation || v5.yearly_min_compensation || 0));
      case 'salary_asc': return Math.round(v5.yearly_min_compensation || v5.yearly_max_compensation || 1e7);
      case 'newest': return Math.round((Date.now() - (v5.estimated_publish_date_millis || 0)) / 60000);
      case 'company_size': return Math.round(1e7 - (coOf(ctl).nb_employees || 0));
      default: return 0;
    }
  }

  const expandedCompanies = new Set();
  function companyKey(name) { return normName(name); }

  function recomputeGroups() {
    for (const ctl of state.cards.values()) {
      ctl.root.classList.remove('hcx-dupe-collapsed');
      ctl.root.querySelector(':scope .hcx-dupe-chip')?.remove();
      syncCell(ctl);
    }
    if (!S().companyCollapse || S().ungroupCarousels) return;
    const groups = new Map();

    const sorting = S().sortMode && S().sortMode !== 'default';
    const inOrder = [...state.cards.values()]
      .filter(c => c.root.isConnected && (c.surface === 'grid' || c.surface === 'synthetic') &&
        !c.root.classList.contains('hcx-hidden-collapsed') && !c.root.classList.contains('hcx-blocked') &&
        !c.root.classList.contains('hcx-filtered'))

      .sort((a, b) => sorting ? (sortRank(a) - sortRank(b))
        : (a.root.compareDocumentPosition(b.root) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    for (const ctl of inOrder) {
      const key = companyKey(ctl.job.company); if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ctl);
    }
    for (const [key, ctls] of groups) {
      if (ctls.length < 2) continue;
      const [first, ...rest] = ctls;
      const expanded = expandedCompanies.has(key);
      if (!expanded) rest.forEach(c => { c.root.classList.add('hcx-dupe-collapsed'); syncCell(c); });
      const chip = el('button', {
        type: 'button', class: 'hcx-dupe-chip',
        title: (expanded ? 'Collapse ' : 'Show ') + rest.length + ' more from ' + first.job.company,
        text: expanded ? '− collapse ' + rest.length : '+' + rest.length + ' more',
        onclick: e => { e.preventDefault(); e.stopPropagation(); expandedCompanies.has(key) ? expandedCompanies.delete(key) : expandedCompanies.add(key); recomputeGroups(); }
      });
      badgeRow(first).appendChild(chip);
    }
  }
  HCX.recomputeGroups = recomputeGroups;

  let digestBtn = null, digestPanel = null;
  function newCtls() {
    return [...state.cards.values()]
      .filter(c => c.root.isConnected && (c.surface === 'grid' || c.surface === 'synthetic') && !state.seenSnapshot.has(c.slug) &&
        !c.root.classList.contains('hcx-hidden-collapsed') && !c.root.classList.contains('hcx-filtered') && !c.root.classList.contains('hcx-blocked'))
      .sort((a, b) => a.root.compareDocumentPosition(b.root) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }
  function updateDigest() {
    if (!S().digest) { digestBtn?.remove(); digestBtn = null; digestPanel?.remove(); digestPanel = null; return; }
    const fresh = newCtls();
    if (!fresh.length) { digestBtn?.remove(); digestBtn = null; digestPanel?.remove(); digestPanel = null; return; }
    if (!digestBtn) { digestBtn = el('button', { type: 'button', class: 'hcx-digest-btn', onclick: toggleDigest }); document.body.appendChild(digestBtn); HCX.util.makeDraggable(digestBtn, 'digestBtn'); }
    digestBtn.textContent = '✨ ' + fresh.length + ' new';
    if (digestPanel) renderDigest();
  }
  HCX.updateDigest = updateDigest;
  function toggleDigest() { if (digestPanel) { digestPanel.remove(); digestPanel = null; return; } digestPanel = el('div', { class: 'hcx-digest-panel' }); document.body.appendChild(digestPanel); HCX.util.makeDraggable(digestPanel, 'digestPanel'); renderDigest(); }
  function renderDigest() {
    if (!digestPanel) return;
    const fresh = newCtls();
    digestPanel.textContent = '';
    digestPanel.append(el('div', { class: 'hcx-digest-head', text: fresh.length + ' new job' + (fresh.length === 1 ? '' : 's') + ' on this page' }));
    const list = el('div', { class: 'hcx-digest-list' });
    for (const ctl of fresh) {
      list.appendChild(el('button', { type: 'button', class: 'hcx-digest-item', onclick: () => HCX.setFocus && HCX.setFocus(ctl) },
        el('span', { class: 't', text: ctl.job.title || '(untitled)' }),
        el('span', { class: 'c', text: (ctl.job.company || '?') + (ctl.job.location ? ' — ' + ctl.job.location : '') })));
    }
    const foot = el('div', { class: 'hcx-digest-foot' },
      el('button', { type: 'button', text: 'Mark all seen', onclick: () => { for (const ctl of newCtls()) { HCX.queueSeen(ctl.slug); state.seenSnapshot.add(ctl.slug); ctl.root.querySelector(':scope .hcx-new')?.remove(); if (S().dimSeen) ctl.root.classList.add('hcx-seen'); } updateDigest(); } }),
      el('button', { type: 'button', text: 'Close', onclick: toggleDigest }));
    digestPanel.append(list, foot);
  }

  const FILTER_MODES = [
    { key: 'all', label: 'All' },
    { key: 'not_linkedin', label: '∉ LinkedIn' },
    { key: 'not_indeed', label: '∉ Indeed' },
    { key: 'neither', label: '💎 Gems' }
  ];
  const SORTS = [['default', 'Sort'], ['rating', '★ Rating'], ['salary_desc', '$ High'], ['salary_asc', '$ Low'], ['newest', '🕐 New'], ['company_size', '👥 Size']];
  let filterBar = null;
  function ensureFilterBar() {

    if (!(HCX.isSearchView && HCX.isSearchView())) { if (filterBar) { filterBar.remove(); filterBar = null; } return; }
    if (!filterBar || !filterBar.isConnected) {
      filterBar = el('div', { class: 'hcx-filter-bar' });
      for (const mode of FILTER_MODES) {
        filterBar.appendChild(el('button', {
          type: 'button', dataset: { mode: mode.key },
          onclick: async () => { S().filterMode = mode.key; applyFilterAll(); await persist('filterMode', mode.key); }
        }));
      }
      const sortSel = el('select', { class: 'hcx-sort', onchange: async e => { S().sortMode = e.target.value; applyFilterAll(); await persist('sortMode', e.target.value); } });
      for (const [v, l] of SORTS) sortSel.appendChild(el('option', { value: v, text: l }));
      sortSel.value = S().sortMode || 'default';
      filterBar.appendChild(sortSel);

      filterBar.appendChild(el('button', {
        type: 'button', class: 'hcx-opts-btn', title: 'Build filters to hide jobs',
        text: '⚙ Filters', onclick: () => HCX.openFilters && HCX.openFilters()
      }));

      filterBar.appendChild(el('button', {
        type: 'button', class: 'hcx-opts-btn', title: 'Export jobs',
        text: '⬇ Export', onclick: () => HCX.openExport && HCX.openExport()
      }));
      document.body.appendChild(filterBar);
      HCX.util.makeDraggable(filterBar, 'filterBar');
    }
    updateFilterBar();
  }
  async function persist(key, val) { try { const { settings = {} } = await api.storage.local.get('settings'); settings[key] = val; await api.storage.local.set({ settings }); } catch { } }
  function updateFilterBar() {
    if (!filterBar) return;
    const ctls = [...state.cards.values()].filter(c => c.root.isConnected && (c.surface === 'grid' || c.surface === 'synthetic') && !c.root.classList.contains('hcx-blocked'));
    const foundP = p => ctls.filter(c => c.results[p]?.status === 'found').length;
    const counts = { all: ctls.length, not_linkedin: ctls.length - foundP('linkedin'), not_indeed: ctls.length - foundP('indeed'), neither: ctls.filter(c => c.results.linkedin?.status !== 'found' && c.results.indeed?.status !== 'found').length };
    for (const btn of filterBar.querySelectorAll('button')) {
      const mode = btn.dataset.mode;
      if (!mode) continue;
      const meta = FILTER_MODES.find(m => m.key === mode);
      btn.textContent = meta.label + ' ' + counts[mode];
      btn.classList.toggle('hcx-active', S().filterMode === mode);
    }
    const sel = filterBar.querySelector('.hcx-sort'); if (sel) sel.value = S().sortMode || 'default';
  }
  let countsTimer = null;
  function scheduleCounts() { if (countsTimer) return; countsTimer = setTimeout(() => { countsTimer = null; updateFilterBar(); updateDigest(); }, 300); }

  function ensureProvider(ctl, provider) {
    if (!S()[provider]) { ctl.root.querySelector(':scope .' + PROVIDER_META[provider].cls)?.remove(); return; }
    const has = ctl.root.querySelector(':scope .' + PROVIDER_META[provider].cls);
    if (has) return;
    const prev = ctl.results[provider];
    if (prev && prev.status !== 'checking') { renderProviderBadge(ctl, provider, prev); return; }
    if (ctl.dispatched[provider]) { renderProviderBadge(ctl, provider, { status: 'checking' }); return; }
    runCheck(ctl, provider);
  }
  function ensureRating(ctl) {
    if (!S().companyRatings) { ctl.root.querySelector(':scope .hcx-rating')?.remove(); return; }
    if (ctl.root.querySelector(':scope .hcx-rating')) return;
    if (ctl.rating && ctl.rating.status !== 'checking') { renderRating(ctl, ctl.rating); return; }
    if (ctl.dispatched.rating) { renderRating(ctl, { status: 'checking' }); return; }
    runRating(ctl);
  }

  HCX.renderers.push(
    renderNew,
    warmGroup,
    ctl => { ensureProvider(ctl, 'linkedin'); ensureProvider(ctl, 'indeed'); },
    ensureRating,
    renderIntel, renderATS, renderSalary, renderSignals, renderLayoffs, renderTrackerStats,
    ctl => { applyMarkStyles(ctl); addActionBar(ctl); renderNoteIndicator(ctl); },
    renderHideCompany,
    applyFilter
  );

  function refreshHideCompany() {
    const jp = [...state.cards.values()].find(c => c.surface === 'jobpage' && c.root.isConnected);
    if (jp) renderHideCompany(jp);
  }

  HCX.hooks.onCardsChanged.push(() => { recomputeGroups(); updateDigest(); ensureFilterBar(); });
  HCX.hooks.onSettings.push(() => { document.documentElement.classList.toggle('hcx-ungroup', !!S().ungroupCarousels); applyFilterAll(); recomputeGroups(); ensureFilterBar(); refreshHideCompany(); });

  HCX.hooks.onNewQuery.push(() => expandedCompanies.clear());
  HCX.applyFilterAll = applyFilterAll;
  HCX.afterBoot(() => { rebuildAutoHide(); document.documentElement.classList.toggle('hcx-ungroup', !!S().ungroupCarousels); ensureFilterBar(); });
})();
