import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseStructuredJob, cleanJobUrl, extractJobFromEvidence, jobDescriptionText } from '../src/job-extraction-core.mjs';
import { createJobExtractionService } from '../src/job-extraction-service.mjs';

const description = 'About the role\nBuild reliable data services with TypeScript and SQL.\nResponsibilities\nDevelop APIs and collaborate with the product team.\nRequirements\nExperience with Python, automated testing, and distributed systems.\nBenefits\nFlexible working hours and professional development.';
const page = overrides => ({url:'https://careers.example.test/jobs/1234',pageTitle:'Platform Engineer at Acme',headings:['Platform Engineer'],meta:{},structured:[],states:[],descriptions:[],...overrides});
const capture = evidence => ({url:evidence.url,documents:[evidence],blockedFrames:[]});

test('structured data produces four fields, preserving readable lists and job identity parameters', () => {
  const evidence=page({url:'https://careers.example.test/jobs/1234?jobId=42&utm_source=test',structured:[
    {title:'Platform Engineer',company:'Acme',description:'<p>Build APIs &amp; tools.</p><ul><li>Python &#38; SQL</li><li>Testing</li></ul>',url:'/jobs/1234?jobId=42'}
  ]});
  assert.deepEqual(extractJobFromEvidence(capture(evidence)).fields, {
    company:'Acme',role:'Platform Engineer',url:'https://careers.example.test/jobs/1234?jobId=42',
    description:'Build APIs & tools.\n\n• Python & SQL\n\n• Testing'
  });
});

test('current job IDs and active headings select the right posting instead of the first recommendation', () => {
  const evidence=page({url:'https://www.linkedin.com/jobs/search/?currentJobId=42',headings:[],pageTitle:'Jobs'});
  const candidates=[{title:'Wrong role',company:'Other',description,url:evidence.url,id:'99'},
    {title:'Correct role',company:'Acme',description,url:evidence.url,id:'42'}];
  assert.equal(chooseStructuredJob(candidates,evidence).title,'Correct role');
  assert.equal(chooseStructuredJob(candidates,page({headings:[],pageTitle:'Search jobs'})),null);
  assert.equal(chooseStructuredJob(candidates.map(({url,id,...candidate})=>candidate),page({headings:[],pageTitle:'Search jobs'})),null);
  assert.equal(chooseStructuredJob(candidates,page({headings:['Correct role']})).company,'Acme');
});

test('active ATS selectors override mismatched recommendation schema and retain complete description sections', () => {
  const evidence=page({site:'Workday',role:'Platform Engineer',company:'Acme',structured:[
    {title:'Accountant',company:'Other company',description:'An unrelated recommended role',url:'/jobs/5555'}
  ],descriptions:[{text:description,source:'Workday',rank:90,linkRatio:0}]});
  const result=extractJobFromEvidence(capture(evidence));
  assert.equal(result.fields.company,'Acme');
  assert.equal(result.fields.role,'Platform Engineer');
  assert.equal(result.fields.description,description);
  assert.equal(result.source,'Workday');
});

test('unknown career pages can use a job-like content region without falling back to privacy-page dumps', () => {
  const evidence=page({descriptions:[{text:description,source:'main content',rank:30,linkRatio:0}]});
  assert.equal(extractJobFromEvidence(capture(evidence)).fields.company,'Acme');
  assert.equal(extractJobFromEvidence(capture(page({pageTitle:'Privacy Policy',headings:['Privacy Policy'],
    descriptions:[{text:'This policy explains how personal data is stored. '.repeat(20),source:'page body',rank:10}]}))),null);
});

test('embedded page data and accessible child frames keep the outer job URL', () => {
  const child=page({url:'https://careers.example.test/embedded/1234',states:[{title:'Platform Engineer',company:'Acme',description,type:'page-json'}]});
  const result=extractJobFromEvidence({url:'https://careers.example.test/careers?jobId=1234',documents:[page({headings:[],pageTitle:'Careers'}),child]});
  assert.equal(result.fields.url,'https://careers.example.test/careers?jobId=1234');
  assert.equal(result.fields.description,description);
  assert.equal(result.source,'Embedded job JSON');
});

test('job boards are not invented as employers, while explicit employer data is accepted', () => {
  const evidence=page({pageTitle:'Platform Engineer | LinkedIn',meta:{'og:site_name':'LinkedIn'},
    structured:[{title:'Platform Engineer',description}]});
  const result=extractJobFromEvidence(capture(evidence));
  assert.equal(result.fields.company,'');
  assert.ok(result.missing.includes('company'));
  evidence.structured[0].company='LinkedIn';
  assert.equal(extractJobFromEvidence(capture(evidence)).fields.company,'LinkedIn');
});

test('HTML conversion removes active content and URL cleaning rejects unsafe schemes and credentials', () => {
  assert.equal(jobDescriptionText('<script>bad()</script><style>secret{}</style><p>Use &lt;widgets&gt; &amp; SQL &#x2022; safely.</p>'), 'Use <widgets> & SQL • safely.');
  assert.equal(jobDescriptionText('&lt;p&gt;Requirements&lt;/p&gt;&lt;p&gt;Testing&lt;/p&gt;'),'Requirements\n\nTesting');
  for (const url of ['javascript:alert(1)','file:///tmp/job','https://user:password@jobs.test/role']) assert.equal(cleanJobUrl(url),'');
  assert.equal(cleanJobUrl('', 'https://jobs.test/role'),'');
});

test('background extraction targets only the requested tab and rejects navigation races', async () => {
  const evidence=page({structured:[{title:'Platform Engineer',company:'Acme',description}]});
  const calls=[];
  const browser={tabs:{get:async()=>({url:evidence.url})},scripting:{executeScript:async options=>{
    calls.push(options);return [{frameId:0,result:capture(evidence)}];
  }}};
  const read=createJobExtractionService(browser);
  assert.equal((await read(7)).fields.company,'Acme');
  assert.deepEqual(calls[0].target,{tabId:7});
  let reads=0;
  browser.tabs.get=async()=>({url:++reads===1 ? evidence.url : 'https://careers.example.test/jobs/other'});
  await assert.rejects(()=>read(7),error=>error.code==='page-changed');
  browser.tabs.get=async()=>({url:evidence.url});
  browser.scripting.executeScript=async()=>{throw new Error('No permission');};
  await assert.rejects(()=>read(7),error=>error.code==='page-access');
});
