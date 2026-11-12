const clean = value => typeof value === 'string' ? value.replace(/\u00a0/g,' ').replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim() : '';
const normalized = value => clean(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const boardNames = /^(linkedin|indeed|glassdoor|greenhouse|lever|ashby|workday|smartrecruiters|workable|hiring\s?cafe|jobright|ziprecruiter|handshake|wellfound|dice|careers?|jobs?|job search)$/i;
const sectionName = /^(job description|about (the role|you|us|the team)|responsibilities|qualifications|requirements|benefits|similar jobs|recommended jobs|apply( now)?|sign in|log in|careers?|jobs?|job search|search results)$/i;
const cuePattern = /responsibilit\w*|qualificat\w*|requirements?|years? of experience|experience (with|in)|about the role|what you.ll do|we.re looking for|skills|benefits|compensation|salary|equal opportunity|responsabilit\w*|requisitos|anforderungen|aufgaben|expérience|岗位职责|任职要求/giu;

export function cleanJobUrl(value, base) {
  if (typeof value!=='string' || !value.trim()) return '';
  try {
    const url = new URL(value,base);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|trk|trackingId|refId|referral|source)$/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return ''; }
}

export function jobDescriptionText(value) {
  let text = typeof value === 'string' ? value : '';
  const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',bull:'•',hellip:'…',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',middot:'·',copy:'©',reg:'®',euro:'€',pound:'£',ensp:' ',emsp:' ',thinsp:' ',eacute:'é',Eacute:'É',aacute:'á',ouml:'ö',uuml:'ü',szlig:'ß'};
  const decode = input => input.replace(/&(#x[\da-f]+|#\d+|[a-zA-Z]+);/gi,(whole,key) => {
    if (key[0] !== '#') return entities[key] ?? whole;
    const code = key[1]?.toLowerCase()==='x' ? parseInt(key.slice(2),16) : parseInt(key.slice(1),10);
    return code>0 && code<=0x10ffff && !(code>=0xd800 && code<=0xdfff) ? String.fromCodePoint(code) : ' ';
  });
  if (!/<[a-z][^>]*>/i.test(text) && /&lt;\/?(?:p|div|li|ul|h[1-6])\b/i.test(text)) text = decode(text);
  text = text.replace(/<!--[^]*?-->/g,'').replace(/<(script|style|noscript|template)\b[^>]*>[^]*?(?:<\/\1\s*>|$)/gi,'')
    .replace(/<li\b[^>]*>/gi,'\n• ').replace(/<\/?(?:p|div|section|article|h[1-6]|ul|ol|li|tr|br|hr)\b[^>]*>/gi,'\n')
    .replace(/<[^>]*>/g,'');
  return clean(decode(text)).slice(0,100000);
}

function roleText(value) {
  const text = clean(value).split('\n')[0].replace(/\s+(?:[-|–—]\s*)?(?:apply now|job details|job opening)\s*$/i,'').trim();
  return text && text.length<=220 && !sectionName.test(text) && !/^(privacy policy|cookie policy|terms of (use|service))\b/i.test(text) ? text : '';
}
function companyText(value, trusted=true) {
  const text = clean(value).split('\n')[0].replace(/^at\s+/i,'').replace(/\s+(?:company\s+)?logo$/i,'').trim();
  return text && text.length<=180 && !sectionName.test(text) && (trusted || !boardNames.test(text) && !/^(?:ai(?:[- ]powered)?\s+)?job\s+search(?:\s+engine)?$/i.test(text)) ? text : '';
}
function titleParts(evidence) {
  const source = clean(evidence.meta?.['og:title'] || evidence.pageTitle).replace(/\s*[|–—-]\s*(?:LinkedIn|Indeed|Glassdoor|Greenhouse|Lever|Ashby|Workday|Hiring\s?Cafe|Jobright|Handshake|SmartRecruiters)\s*$/i,'');
  const at = source.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (at) return {role:roleText(at[1]),company:companyText(at[2],false)};
  const pieces = source.split(/\s+[|–—-]\s+/).map(clean).filter(Boolean);
  const heading = roleText(evidence.role || evidence.semanticRole || evidence.headings?.[0]);
  if (pieces.length===2) {
    if (normalized(heading)===normalized(pieces[1])) return {role:heading,company:companyText(pieces[0],false)};
    return {role:roleText(pieces[0]),company:companyText(pieces[1],false)};
  }
  return {role:roleText(source),company:''};
}
function identityMatch(candidate, evidence) {
  const page = cleanJobUrl(evidence.url), target=cleanJobUrl(candidate.url,evidence.url);
  const current = new URL(page);
  const selected = ['currentJobId','jobId','job_id','selectedJobId','gh_jid','jk','requisitionId'].map(key=>current.searchParams.get(key)).filter(Boolean);
  const candidateId = /^[\w-]+$/.test(candidate.id || '') ? candidate.id : '';
  if (selected.some(id => candidateId===id || (!candidateId && target && new URL(target).pathname.includes(id)))) return 120;
  if (selected.length && candidateId) return 0;
  if (target && target===page) return 90;
  if (candidate.id && candidate.id.length>=4 && (current.pathname.includes(candidate.id) || current.hash.includes(candidate.id))) return 70;
  return 0;
}
export function chooseStructuredJob(candidates, evidence) {
  if (!candidates?.length || !cleanJobUrl(evidence.url)) return null;
  const heading = normalized(evidence.role || evidence.semanticRole || evidence.headings?.[0]);
  const ranked = candidates.filter(item=>roleText(item.title)).map(item => {
    const identity = identityMatch(item,evidence);
    const title = normalized(item.title);
    const headingMatch = Boolean(heading && title && (title===heading || heading.includes(title) || title.includes(heading)));
    const employerMatch=evidence.site==='HiringCafe' && normalized(evidence.company) && normalized(evidence.company)===normalized(item.company);
    const score = identity + (headingMatch ? 40 : 0) + (employerMatch ? 30 : 0) + (item.description ? 12 : 0) + (item.company ? 5 : 0);
    return {item,score,identity,identified:identity>0 || headingMatch,headingMatch};
  }).sort((a,b)=>b.score-a.score);
  if (!ranked.length) return null;
  const different = ranked.find(value => normalized(value.item.title)!==normalized(ranked[0].item.title) ||
    (value.item.company && ranked[0].item.company && normalized(value.item.company)!==normalized(ranked[0].item.company)) ||
    (value.item.id && ranked[0].item.id && value.item.id!==ranked[0].item.id));
  if (different && !ranked[0].identified && ranked[0].score-different.score<20) return null;
  if(evidence.site==='HiringCafe' && different && !ranked[0].identity && ranked[0].score===different.score) return null;
  if (roleText(evidence.role) && !ranked[0].identified) return null;
  return ranked[0].item;
}
function cues(text) { return (text.match(cuePattern) || []).length; }
function documentJob(evidence) {
  const structured = chooseStructuredJob(evidence.structured,evidence);
  const state = chooseStructuredJob(evidence.states,evidence);
  const primary = structured || state;
  const parsed = titleParts(evidence);
  const hiringCafe=evidence.site==='HiringCafe'||/^https?:\/\/(?:[\w-]+\.)?(?:hiring\.cafe|hiringcafe\.com)(?:[/:]|$)/i.test(evidence.url || '');
  const domCompany=value=>companyText(value,!hiringCafe);
  let company = domCompany(evidence.company) || companyText(primary?.company) || domCompany(evidence.semanticCompany) || parsed.company;
  let role = roleText(evidence.role) || roleText(primary?.title) || roleText(evidence.semanticRole);
  let roleKind = !roleText(evidence.role) && roleText(primary?.title) ? 'structured' : 'page';
  if (!role || normalized(role)===normalized(company)) {
    role = (evidence.headings || []).map(roleText).find(text=>text && normalized(text)!==normalized(company)) || parsed.role;
    roleKind = 'page';
  }
  if (!company) company = companyText(evidence.meta?.company,false) || companyText(evidence.meta?.['og:site_name'],false);
  const dom = (evidence.descriptions || []).map(item => {
    const text = clean(item.text).slice(0,100000), hits=cues(text);
    const accepted = text.length>=60 && (item.rank>=75 || (text.length>=160 && hits>=2));
    return {...item,text,hits,score:accepted ? item.rank + Math.min(hits,12)*2 + Math.min(15,Math.log2(text.length)) - (item.linkRatio || 0)*60 -
      (/similar jobs|recommended jobs|search results/i.test(text) ? 15 : 0) : -1};
  }).filter(item=>item.score>=0).sort((a,b)=>b.score-a.score);
  const native = dom[0];
  let description = jobDescriptionText(primary?.description);
  let source = structured ? structured.type==='microdata' ? 'JobPosting microdata' : 'JobPosting JSON-LD' : state ? 'Embedded job JSON' : native?.source || '';
  if (native && (!description || (native.rank>=75 && native.text.length>description.length*1.3))) {
    description=native.text; source=native.source;
  }
  const semantic = native?.rank>=75;
  const ambiguous = evidence.structured?.length>1 && !structured;
  if (ambiguous && !semantic) return null;
  if (!description || (!primary && !(semantic && (role || company)) && !(native?.hits>=2 && role))) return null;
  if (state && !structured && !evidence.site && cues(description)<2 && !semantic) return null;
  const certainty = structured ? 100 : state ? 92 : semantic ? 85 : 55;
  const provenance = { company: !company ? { kind: 'missing' } : { kind: !domCompany(evidence.company) && companyText(primary?.company) ? 'structured' : 'page',
    source: !domCompany(evidence.company) && companyText(primary?.company) ? structured ? 'JobPosting' : 'Embedded job JSON' : 'Page metadata or DOM' },
    role: !role ? { kind: 'missing' } : { kind: roleKind, source: roleKind === 'structured' ? structured ? 'JobPosting' : 'Embedded job JSON' : 'Page metadata or DOM' } };
  return {company,role,description,url:cleanJobUrl(evidence.url),source,provenance,
    cleanupContext: [evidence.pageTitle,...(evidence.headings || []),JSON.stringify(primary || {}), ...(evidence.descriptions || []).filter(item=>item.rank>=75).slice(0,2).map(item=>item.text)].filter(Boolean).join('\n\n').slice(0,25000),
    score:certainty + (company ? 5 : 0) + (role ? 5 : 0) + Math.min(description.length/1000,10)};
}

export function extractJobFromEvidence(capture) {
  const jobs = (capture?.documents || []).map(documentJob).filter(Boolean).sort((a,b)=>b.score-a.score);
  const job = jobs[0];
  if (!job) return null;
  const fields = {company:job.company,role:job.role,url:cleanJobUrl(capture.url),description:job.description};
  return {fields,source:job.source,provenance:job.provenance,cleanupEvidence:{context:job.cleanupContext},missing:Object.entries(fields).filter(([,value])=>!value).map(([key])=>key),
    blockedFrames:(capture.blockedFrames || []).length};
}
