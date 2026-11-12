// Serialized by chrome.scripting: keep this function independent of module scope.
export function collectJobEvidence(adapters) {
  const clean = value => String(value || '').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  const documents = [], blockedFrames = [], visited = new Set();
  function inspect(doc, depth) {
    if (!doc?.documentElement || visited.has(doc) || depth > 3 || documents.length >= 8) return;
    visited.add(doc);
    const view = doc.defaultView;
    const roots = [doc];
    for (let i=0; i<roots.length && roots.length<25; i++) {
      for (const element of [...roots[i].querySelectorAll('*')].slice(0,12000)) {
        if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
      }
    }
    const query = selector => roots.flatMap(root => { try { return [...root.querySelectorAll(selector)]; } catch { return []; } });
    const visible = element => {
      if (element.closest('[hidden],[aria-hidden="true"]')) return false;
      const style = view.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && (style.display === 'contents' || element.getClientRects().length > 0);
    };
    const cache = new WeakMap();
    function textOf(element) {
      if (!element || !visible(element)) return '';
      if (cache.has(element)) return cache.get(element);
      const parts = []; let size=0, nodes=0;
      const skip = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|INPUT|TEXTAREA|SELECT|BUTTON|NAV|FOOTER)$/;
      const block = /^(P|DIV|SECTION|ARTICLE|LI|UL|OL|H[1-6]|TR|BLOCKQUOTE|PRE)$/;
      function walk(node, level=0) {
        if (size > 100000 || nodes++ > 8000 || level > 50) return;
        if (node.nodeType === 3) { parts.push(node.data); size += node.length; return; }
        if (node.nodeType !== 1 || skip.test(node.tagName) || node.matches('[contenteditable]:not([contenteditable="false"])') || !visible(node)) return;
        if (node.tagName === 'BR') { parts.push('\n'); return; }
        const boundary = block.test(node.tagName);
        if (boundary) parts.push('\n');
        if (node.tagName === 'LI') parts.push('• ');
        for (const child of node.childNodes) walk(child,level+1);
        if (boundary) parts.push('\n');
      }
      walk(element);
      const text = clean(parts.join('')).slice(0,100000);
      cache.set(element,text);
      return text;
    }
    const first = selectors => {
      for (const selector of selectors || []) {
        for (const element of query(selector)) {
          if (!visible(element)) continue;
          const text = clean(element.tagName === 'IMG' ? element.alt : textOf(element)).split('\n')[0];
          const value = text || element.getAttribute('data-company-name');
          if (value && !/^(true|false)$/i.test(value)) return value.slice(0,300);
        }
      }
      return '';
    };
    const pageUrl = /^https?:/.test(doc.URL) ? doc.URL : doc.baseURI;
    let host = ''; try { host = new URL(pageUrl).hostname; } catch {}
    const adapter = adapters.find(item => new RegExp(item.host,'i').test(host)) ||
      adapters.find(item => item.signature && query(item.signature).some(visible));
    const evidence = {url:pageUrl, pageTitle:doc.title || '', site:adapter?.name || '',
      role:first(adapter?.role), company:first(adapter?.company),
      semanticRole:first(['[itemprop="title"]','[data-job-title]','[data-testid="job-title"]']),
      semanticCompany:first(['[itemprop="hiringOrganization"] [itemprop="name"]','[itemprop="hiringOrganization"]','[data-company-name]','[data-testid="company-name"]','.company-name']),
      headings:query('h1,h2').filter(visible).map(textOf).filter(Boolean).slice(0,12),
      meta:{}, structured:[], states:[], descriptions:[]};
    let hiringScope=null;
    if(adapter?.name==='HiringCafe') {
      const dialogs=query('[role="dialog"]').filter(node=>visible(node)&&node.querySelector('[data-testid="drawer-header-bar"]'));
      hiringScope=dialogs.at(-1) || null;
      const scope=hiringScope || doc.querySelector('main') || doc.body;
      const headings=[...scope.querySelectorAll(hiringScope ? 'h2.font-extrabold,h2[class*="text-3xl"],[data-testid="job-title"],h1' : '[data-testid="job-title"],h1')].filter(visible);
      const heading=headings.find(node=>!node.closest('nav,header,aside')&&!/^(?:hiring\s?cafe|ai(?:[- ]powered)? job search(?: engine)?)$/i.test(clean(textOf(node))));
      if(heading) {
        evidence.role=textOf(heading).split('\n')[0];
        const sibling=heading.nextElementSibling;
        let company='';
        if(sibling&&visible(sibling)) {
          const name=sibling.matches('.font-bold,[class*="font-bold"],[data-testid="company-name"]') ? sibling : sibling.querySelector(hiringScope ? '[data-testid="company-name"],.font-bold,span' : '[data-testid="company-name"],.font-bold,strong');
          if(name&&visible(name))company=textOf(name).replace(/^@\s*/,'');
        }
        if(!company) {
          const logo=heading.parentElement?.querySelector('img[alt]');
          if(logo&&visible(logo))company=clean(logo.alt).replace(/\s+logo$/i,'');
        }
        const localCompany=heading.parentElement?.querySelector('[data-testid="company-name"],[data-company-name],.company-name');
        evidence.company=company || textOf(localCompany);
        evidence.semanticCompany=evidence.company;
        // Keep a page-wide company marker from a recommended card out of a selected drawer.
        if(hiringScope) {
          const labelled=hiringScope.querySelector('[data-testid="company-name"],[data-company-name],.company-name');
          evidence.company=company || textOf(labelled);
          evidence.semanticCompany='';
        }
      }
    }
    for (const key of ['og:title','og:site_name','twitter:title','description','company','author']) {
      const node = doc.querySelector(`meta[property="${key}"],meta[name="${key}"]`);
      if (node?.content) evidence.meta[key] = clean(node.content).slice(0,3000);
    }
    evidence.canonical = doc.querySelector('link[rel="canonical"]')?.href || '';
    // Only return job fields from JSON. Do not relay hydration/session objects.
    let scanned=0;
    function jobObject(node, type) {
      const org = node.hiringOrganization;
      const company = typeof org==='string' ? org : org?.name || node.companyName || node.company_name ||
        (typeof node.company==='string' ? node.company : node.company?.name) || node.company_info?.name ||
        node.company_information?.name || node.v5_processed_job_data?.company_name || node.enriched_company_data?.name || node.organization?.name;
      const title = node.title || node.jobTitle || node.job_title || node.job_information?.title || node.v5_processed_job_data?.core_job_title;
      let description = node.description || node.jobDescription || node.job_description || node.descriptionHtml ||
        node.descriptionPlainText || node.job_information?.description || node.job_information?.description_html;
      if (!description && (node.jobSummary || node.jdResponsibilitySummary)) {
        const sections = [node.jobSummary || node.jdResponsibilitySummary];
        for (const [heading, values] of [['Responsibilities',node.coreResponsibilities],['Requirements',node.skillSummaries || node.qualifications?.mustHave],['Benefits',node.benefitsSummaries]]) {
          if (Array.isArray(values) && values.length) sections.push(`${heading}\n${values.filter(value=>typeof value==='string').map(value=>'• '+value).join('\n')}`);
        }
        description = sections.join('\n\n');
      }
      const value = { title:typeof title==='string' ? title.slice(0,500) : '', company:typeof company==='string' ? company.slice(0,300) : '',
        description:typeof description==='string' ? description.slice(0,100000) : '',
        url:typeof node.url==='string' ? node.url : node.jobUrl || node.job_url || '',
        id:String(node.identifier?.value || node.identifier || node.id || node._id || node.jobId || node.requisition_id || '').slice(0,150), type };
      if (typeof node.salary === 'string') value.salary = node.salary.slice(0,500);
      const pay = node.baseSalary, range = pay?.value;
      if (pay && typeof pay === 'object' && range && typeof range === 'object') value.salary = [pay.currency,range.minValue,range.maxValue,range.value,range.unitText].filter(item=>typeof item === 'string' || typeof item === 'number').join(' ').slice(0,500);
      if (value.title && (value.description || type==='json-ld')) (type==='json-ld' ? evidence.structured : evidence.states).push(value);
    }
    function walkJson(node, type, level=0, refs=new Map()) {
      if (!node || typeof node!=='object' || level>20 || scanned++>12000) return;
      if (Array.isArray(node)) { for (const value of node) walkJson(value,type,level+1,refs); return; }
      if (type==='json-ld') {
        const types = [].concat(node['@type'] || []);
        if (types.some(value=>/(^|[/#])JobPosting$/.test(value))) {
          const orgRef = node.hiringOrganization?.['@id'];
          jobObject(orgRef && refs.has(orgRef) ? {...node,hiringOrganization:refs.get(orgRef)} : node,type);
        }
      } else jobObject(node,type);
      for (const value of Object.values(node)) if (value && typeof value==='object') walkJson(value,type,level+1,refs);
    }
    for (const script of query('script[type="application/ld+json"],script#__NEXT_DATA__,script[type="application/json"]')) {
      if (script.textContent.length > 2500000 || evidence.structured.length + evidence.states.length > 150) continue;
      try {
        const json = JSON.parse(script.textContent);
        const refs = new Map();
        const index = node => {
          if (!node || typeof node!=='object') return;
          if (Array.isArray(node)) { node.forEach(index); return; }
          if (node['@id']) refs.set(node['@id'],node);
          if (node['@graph']) index(node['@graph']);
        };
        index(json);
        walkJson(json,script.type==='application/ld+json' ? 'json-ld' : 'page-json',0,refs);
      } catch { /* Malformed metadata is not executable code. Continue with DOM. */ }
    }
    for (const scope of query('[itemscope][itemtype*="JobPosting"]').slice(0,40)) {
      const prop = name => {
        const element = scope.querySelector(`[itemprop="${name}"]`);
        return element?.getAttribute('content') || element?.getAttribute('href') || textOf(element);
      };
      const org = scope.querySelector('[itemprop="hiringOrganization"]');
      const orgName = org?.querySelector('[itemprop="name"]');
      evidence.structured.push({title:prop('title'),description:prop('description'),url:prop('url'),
        company:orgName?.getAttribute('content') || textOf(orgName) || textOf(org),type:'microdata'});
    }
    const seen = new Set();
    function add(element, source, rank) {
      if (!element || seen.has(element) || evidence.descriptions.length >= 32) return;
      seen.add(element);
      const text = textOf(element);
      if (text.length < 60) return;
      const links = [...element.querySelectorAll('a')].reduce((total,link)=>total+(link.textContent?.length || 0),0);
      evidence.descriptions.push({text,source,rank,linkRatio:Math.min(1,links/text.length)});
    }
    const specific = [];
    for (const selector of adapter?.description || []) {
      const nodes = query(selector).filter(visible).slice(0,5);
      for (const node of nodes) { add(node,adapter.name,90); specific.push(node); }
      if (nodes.length && !adapter.combine) break;
    }
    if (adapter?.combine && specific.length > 1) {
      const top = [...new Set(specific)].filter(node=>!specific.some(other=>other!==node && other.contains(node)));
      const text = clean(top.map(textOf).join('\n\n'));
      if (text.length >= 60) evidence.descriptions.unshift({text,source:adapter.name,rank:94,linkRatio:0});
    }
    for (const selector of ['[itemprop="description"]','[data-job-description]','[data-testid="job-description"]','[id*="job-description" i]','[class*="job-description" i]','[class*="jobDescription"]']) {
      for (const node of query(selector).slice(0,5)) add(node,'semantic DOM',75);
    }
    for (const heading of query('h2,h3,h4').slice(0,80)) {
      if (/responsibilit|qualification|requirements|about the role|what you.ll do|job description/i.test(heading.textContent || '')) {
        add(heading.parentElement,'section scan',45); add(heading.parentElement?.parentElement,'section scan',40);
      }
    }
    for (const node of query('main,article,[role="main"],section').slice(0,30)) add(node,'main content',30);
    if(hiringScope) add(hiringScope,'HiringCafe selected listing',90);
    add(doc.body,'page body',10);
    documents.push(evidence);
    for (const frame of query('iframe')) {
      try {
        if (frame.contentDocument?.documentElement) inspect(frame.contentDocument,depth+1);
        else if (/^https?:/.test(frame.src)) blockedFrames.push(frame.src);
      } catch { if (/^https?:/.test(frame.src)) blockedFrames.push(frame.src); }
    }
  }
  inspect(document,0);
  return {url:location.href,documents,blockedFrames:blockedFrames.slice(0,8)};
}
