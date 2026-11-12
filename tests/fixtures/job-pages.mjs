export const jobText = '<p>Build reliable data services with TypeScript and SQL.</p><h2>Responsibilities</h2><ul><li>Develop APIs and collaborate with product teams.</li><li>Maintain automated tests and reliable infrastructure.</li></ul><h2>Requirements</h2><p>Experience with Python and distributed systems.</p><h2>Benefits</h2><p>Flexible working hours and professional development.</p>';
const role = 'Platform Engineer';
const json = value => JSON.stringify(value).replace(/</g,'\\u003c');
const schema = (company,url) => `<script type="application/ld+json">${json({'@type':'JobPosting',title:role,hiringOrganization:{name:company},description:jobText,url})}</script>`;
const page = (id,company,body,title=`${role} at ${company}`) => `<!doctype html><html><head><title>${title}</title></head><body data-extraction-fixture="${id}">${body}<textarea>PRIVATE APPLICANT DATA</textarea><div contenteditable="true">PRIVATE EDITOR DATA</div></body></html>`;

export const jobPageFixtures = [
  {id:'jsonld-graph',host:'jobs.example.test',company:'Graph Works',html:page('jsonld-graph','Graph Works',`<h1>${role}</h1><script type="application/ld+json">{broken</script><script type="application/ld+json">${json({'@graph':[
    {'@type':'Organization','@id':'#employer',name:'Graph Works'},
    {'@type':'JobPosting',title:'Unrelated Accountant',hiringOrganization:{name:'Wrong company'},description:jobText,url:'/extract/other-job'},
    {'@type':['Thing','JobPosting'],title:role,hiringOrganization:{'@id':'#employer'},description:jobText,url:'/extract/jsonld-graph'}
  ]})}</script>`)},
  {id:'microdata',host:'jobs.example.test',company:'Microdata Works',html:page('microdata','Microdata Works',`<article itemscope itemtype="https://schema.org/JobPosting"><meta itemprop="title" content="${role}"><h1>${role}</h1><div itemprop="hiringOrganization"><meta itemprop="name" content="Microdata Works"></div><div itemprop="description">${jobText}</div></article>`)},
  {id:'greenhouse',host:'job-boards.greenhouse.io',company:'Greenhouse Works',html:page('greenhouse','Greenhouse Works',`<main><h1 class="app-title">${role}</h1><span class="company-name">at Greenhouse Works</span><div class="job__description">${jobText}</div></main>`)},
  {id:'lever',host:'jobs.lever.co',company:'Lever Works',html:page('lever','Lever Works',`<div class="posting-headline"><h2>${role}</h2></div><span class="posting-company">Lever Works</span><div class="posting-description">${jobText}</div><div class="section-wrapper"><div class="content"><h2>Additional requirements</h2><p>Experience with secure deployment pipelines and cloud operations.</p></div></div>`)},
  {id:'ashby',host:'jobs.ashbyhq.com',company:'Ashby Works',html:page('ashby','Ashby Works',`<h1 class="ashby-job-posting-heading">${role}</h1><span class="ashby-company-name">Ashby Works</span><div class="ashby-job-posting-description">${jobText}</div>`)},
  {id:'workday',host:'acme.wd5.myworkdayjobs.com',company:'Workday Works',html:page('workday','Workday Works',`<h2 data-automation-id="jobPostingHeader">${role}</h2><span data-automation-id="companyName">Workday Works</span><div data-automation-id="jobPostingDescription">${jobText}</div>`)},
  {id:'smartrecruiters',host:'jobs.smartrecruiters.com',company:'SmartRecruiters Works',html:page('smartrecruiters','SmartRecruiters Works',`<h1 class="job-title">${role}</h1><span itemprop="hiringOrganization"><span itemprop="name">SmartRecruiters Works</span></span><div class="job-sections">${jobText}</div>`)},
  {id:'indeed',host:'www.indeed.com',company:'Indeed Employer',html:page('indeed','Indeed Employer',`<h1 data-testid="jobsearch-JobInfoHeader-title">${role}</h1><span data-testid="inlineHeader-companyName">Indeed Employer</span><div id="jobDescriptionText">${jobText}</div>`)},
  {id:'linkedin',host:'www.linkedin.com',query:'?currentJobId=7788',company:'LinkedIn Employer',html:page('linkedin','LinkedIn Employer',`<aside><h1>Recommended roles</h1><span>Wrong company</span></aside><h2 class="job-details-jobs-unified-top-card__job-title">${role}</h2><span class="job-details-jobs-unified-top-card__company-name">LinkedIn Employer</span><div id="job-details">${jobText}</div><script type="application/ld+json">${json([
    {'@type':'JobPosting',title:'Accountant',hiringOrganization:{name:'Wrong company'},description:jobText,identifier:{value:'1111'},url:'https://www.linkedin.com/jobs/view/1111'},
    {'@type':'JobPosting',title:role,hiringOrganization:{name:'LinkedIn Employer'},description:'A short summary',identifier:{value:'7788'},url:'https://www.linkedin.com/jobs/view/7788'}
  ])}</script>`,`${role} | LinkedIn`)},
  {id:'hiringcafe',host:'hiring.cafe',company:'Cafe Works',html:page('hiringcafe','Cafe Works',`<h1>${role}</h1><script id="__NEXT_DATA__" type="application/json">${json({props:{pageProps:{job:{job_information:{title:role,description:jobText},v5_processed_job_data:{core_job_title:role,company_name:'Cafe Works'}}}}})}</script>`)},
  {id:'hiringcafe-header',host:'hiring.cafe',company:'Header Employer',html:page('hiringcafe-header','',`<header><span class="company-name">AI Job Search</span></header><main><section><h1>${role}</h1><a class="font-bold" href="https://example.test">Header Employer</a><div class="job-description">${jobText}</div></section></main>`,`${role} | AI Job Search | HiringCafe`)},
  {id:'hiringcafe-drawer',host:'hiring.cafe',company:'Drawer Employer',html:page('hiringcafe-drawer','',`<main><h1>AI Job Search</h1><span class="company-name">Wrong recommendation</span><h2>${role}</h2></main><div role="dialog"><div data-testid="drawer-header-bar"></div><h2 class="font-extrabold">${role}</h2><div><span>@ Drawer Employer</span></div><div class="job-description">${jobText}</div></div>`,'AI Job Search | HiringCafe')},
  {id:'hiringcafe-logo',host:'hiring.cafe',company:'Logo Employer',html:page('hiringcafe-logo','',`<main><section><img alt="Logo Employer logo"><h1>${role}</h1><div><span>New York</span></div><div class="job-description">${jobText}</div></section></main>`,'AI Job Search | HiringCafe')},
  {id:'jobright',host:'jobright.ai',company:'Jobright Works',includes:['Plan platform architecture','Requirements','Benefits'],html:page('jobright','Jobright Works',`<h1>${role}</h1><script id="jobright-helper-job-detail-info" type="application/json">${json({jobResult:{jobTitle:role,companyName:'Jobright Works',jobSummary:'About the role: build reliable distributed services.',coreResponsibilities:['Plan platform architecture','Maintain reliable APIs and automated tests.'],skillSummaries:['Experience with Python and SQL.'],benefitsSummaries:['Flexible working hours.']}})}</script>`)},
  {id:'generic',host:'jobs.example.test',company:'Independent Works',html:page('generic','Independent Works',`<nav>Browse jobs Privacy Cookies</nav><main><h1>${role}</h1><section>${jobText}</section></main>`)},
  {id:'shadow',host:'jobs.example.test',company:'Shadow Works',shadow:`<h1 class="app-title">${role}</h1><span class="company-name">Shadow Works</span><div class="job__description">${jobText}</div>`,html:page('shadow','Shadow Works','<div id="shadow-host"></div>')},
  {id:'iframe-parent',host:'jobs.example.test',company:'Frame Works',html:page('iframe-parent','Frame Works','<h1>Careers</h1><iframe src="/extract/iframe-child" width="700" height="500"></iframe>','Careers')},
  {id:'delayed',host:'jobs.example.test',company:'Delayed Works',delay:true,html:page('delayed','Delayed Works','<main id="loading-job"><h1>Loading…</h1></main>','Loading job')},
  {id:'partial',host:'jobs.example.test',company:'Keep existing company',partial:true,html:page('partial','','<h1>Platform Engineer</h1><div class="job-description">'+jobText+'</div>','Platform Engineer | LinkedIn')},
  {id:'no-job',host:'jobs.example.test',failure:true,html:page('no-job','','<h1>Privacy Policy</h1><main>'+('This policy explains how data is stored and protected. '.repeat(20))+'</main>','Privacy Policy')},
  {id:'blocked-frame',host:'jobs.example.test',failure:true,html:page('blocked-frame','','<h1>Careers</h1><iframe src="https://blocked.jobs.example.test/extract/iframe-child"></iframe>','Careers')}
];

export function jobFixtureResponse(host, path) {
  if (!path.startsWith('/extract/')) return null;
  const id=path.slice('/extract/'.length).split('?')[0];
  if (id==='iframe-child') return page(id,'Frame Works',`<h1>${role}</h1>${schema('Frame Works','/extract/iframe-child')}`);
  const fixture=jobPageFixtures.find(item=>item.id===id && item.host===host);
  return fixture?.html || null;
}
