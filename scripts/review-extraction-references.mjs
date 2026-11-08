// Download selected public reference files at immutable commits. Never executes them.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../baseline/job-extraction/', import.meta.url));
const repositories = [
  'rakshathavasudev/jd-outreach-drafter', 'muhammad-saadd/applyai',
  'LucasFenaux/job-application-tracker', 'vesaias/JobNavigator',
  'rickyhires/hiringcafeextension', 'HumbleIgnite/hiring-cafe-scraper', 'omkar3602/auto-apply'
];
const preferred = {
  'vesaias/JobNavigator': ['CHANGELOG.md','backend/scraper/ats/_descriptions.py','backend/scraper/ats/generic.py',
    'backend/scraper/ats/greenhouse.py','backend/scraper/ats/lever.py','backend/scraper/ats/ashby.py',
    'backend/scraper/ats/workday.py','backend/scraper/ats/smartrecruiters.py','backend/scraper/ats/oracle_hcm.py',
    'backend/scraper/ats/phenom.py','backend/scraper/_shared/postings.py','extension/content_linkedin.js'],
  'rickyhires/hiringcafeextension': ['content/core.js','content/inject.js','content/features.js']
};
await mkdir(root, {recursive:true});
async function get(url) {
  const response = await fetch(url, {headers:{'User-Agent':'AI-Agent-Template-reference-review',Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response;
}
const index = [];
for (const repository of repositories) {
  const directory = join(root, repository.split('/')[1]);
  try {
    let reference;
    try { reference = JSON.parse(await readFile(join(directory,'reference.json'),'utf8')); } catch {}
    if (!reference?.commit) {
      const metadata = await (await get(`https://api.github.com/repos/${repository}`)).json();
      const commit = await (await get(`https://api.github.com/repos/${repository}/commits/${metadata.default_branch}`)).json();
      reference = {repository,url:`https://github.com/${repository}`,branch:metadata.default_branch,commit:commit.sha,
        license:metadata.license?.spdx_id || 'Not declared in repository metadata',retrievedOn:'2026-11-08'};
    }
    let tree;
    try { tree = JSON.parse(await readFile(join(directory,'tree.json'),'utf8')); } catch {
      tree = await (await get(`https://api.github.com/repos/${repository}/git/trees/${reference.commit}?recursive=1`)).json();
    }
    const score = path => {
      if (preferred[repository]?.includes(path)) return 110;
      if (/^(README(?:\.md)?|LICENSE(?:\.md|\.txt)?|COPYING)$/i.test(path)) return 100;
      if (/(extractor|extract_job|job.?extract|job.?scrap|scrap.*job|jobright|hiring.?cafe)/i.test(path)) return 90;
      if (/(chrome.extension|extension).*\/(content|scrap|extract|parser|selectors)/i.test(path)) return 85;
      if (/(^|\/)(content|background|scraper|parser|extractor|selectors)[^/]*\.(js|ts|py)$/i.test(path)) return 80;
      if (/adapter|extract|scrap|parser|greenhouse|lever|ashby|workday|smartrecruit|jobvite|icims|indeed|linkedin/i.test(path)) return 70;
      if (/CHANGELOG\.md$/i.test(path)) return 60;
      return 0;
    };
    const candidates = tree.tree.filter(item => item.type==='blob' && item.size > 0 && item.size < 600000 &&
      !/(node_modules|package-lock|yarn.lock|pnpm-lock|\.min\.|vendor|test|fixtures)/i.test(item.path) &&
      /\.(js|ts|jsx|tsx|py|md|txt|json)$|^LICENSE$|^COPYING$/i.test(item.path) && score(item.path)>0)
      .sort((a,b) => score(b.path)-score(a.path) || a.path.localeCompare(b.path));
    const selected = candidates.slice(0,24);
    await mkdir(directory,{recursive:true});
    await writeFile(join(directory,'tree.json'),JSON.stringify(tree,null,2)+'\n');
    reference.files = selected.map(item => item.path);
    await writeFile(join(directory,'reference.json'),JSON.stringify(reference,null,2)+'\n');
    for (const item of selected) {
      const destination = resolve(directory,'source',item.path);
      if (!destination.startsWith(resolve(directory,'source') + '/'.replace('/',process.platform==='win32'?'\\':'/'))) throw new Error('Unsafe reference path');
      try { await readFile(destination); continue; } catch {}
      const url = `https://raw.githubusercontent.com/${repository}/${reference.commit}/${item.path.split('/').map(encodeURIComponent).join('/')}`;
      const content = await (await get(url)).text();
      await mkdir(dirname(destination),{recursive:true});
      await writeFile(destination,content);
    }
    index.push(reference);
    console.log(JSON.stringify({repository,commit:reference.commit,license:reference.license,files:reference.files}));
  } catch (error) {
    index.push({repository,url:`https://github.com/${repository}`,error:error.message,retrievedOn:'2026-11-08'});
    console.log(JSON.stringify({repository,error:error.message}));
  }
}
await writeFile(join(root,'index.json'),JSON.stringify(index,null,2)+'\n');
