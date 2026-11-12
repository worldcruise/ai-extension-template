import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupInput,jobCleanupPrompt,validateJobCleanup,isHiringCafe } from '../src/job-cleanup.mjs';
import { exampleProfile } from '../src/resume-data.mjs';

const input = () => ({candidateId:'candidate',profile:exampleProfile,tailor:true,
  job:{company:'Wrong page heading',role:'Jobs',url:'https://hiring.cafe/?jobId=1',description:'Platform Engineer at Clean Employer. Build services with TypeScript and SQL. Salary USD 110,000–140,000 / year.'}});
const job = () => ({id:'job-1',input:cleanupInput(input(),{applyUrls:['https://jobs.example.test/apply/1'],context:'Job details, not another listing.'})});
const reply = () => ({schemaVersion:1,kind:'job-cleanup',requestId:'job-1',runId:'run-1',job:{company:'Clean Employer',title:'Platform Engineer',applyUrl:'https://jobs.example.test/apply/1',description:'Build services with TypeScript and SQL.',salary:{value:'USD 110,000–140,000 / year',source:'listed',evidence:'USD 110,000–140,000 / year',basis:''}}});
test('cleanup prompts bind listing evidence, candidate salary context and observed application links',()=>{
  const prompt=jobCleanupPrompt(job(),'run-1');
  assert.match(prompt,/TASK: JOB_CLEANUP/);assert.match(prompt,/DOCUMENT_RUN:run-1/);assert.match(prompt,/CANDIDATE SALARY CONTEXT/);
  assert.doesNotMatch(prompt, /"contact"|"email"/);assert.match(prompt,/AI estimate/);
  assert.throws(()=>cleanupInput(input(),{}),/Apply link/);
  assert.throws(()=>cleanupInput(input(),{applyUrls:['javascript:alert(1)','https://hiring.cafe/job/1']}),/Apply link/);
  assert.equal(isHiringCafe('https://www.hiringcafe.com/jobs/1'),true);
});
test('validated job JSON replaces noisy fields and labels listed versus estimated salary',()=>{
  const output=validateJobCleanup(JSON.stringify(reply()),job(),'run-1');
  assert.equal(output.role,'Platform Engineer');assert.equal(output.company,'Clean Employer');assert.equal(output.url,'https://jobs.example.test/apply/1');
  assert.equal(output.salarySource,'listed');assert.equal(output.provenance.company.kind,'ai');
  const estimated=reply();estimated.job.salary={value:'USD 100,000–130,000 / year',source:'estimated',evidence:'',basis:'TypeScript and SQL experience; assumes US location and annual pay, not verified employer compensation.'};
  assert.equal(validateJobCleanup(JSON.stringify(estimated),job(),'run-1').salarySource,'estimated');
  estimated.job.salary.basis='';assert.throws(()=>validateJobCleanup(JSON.stringify(estimated),job(),'run-1'),/assumptions/);
});
test('cleanup rejects hallucinated URLs, ungrounded listed pay, wrong IDs and unsupported fields',()=>{
  for(const edit of [v=>v.job.applyUrl='https://hiring.cafe/job/1',v=>v.job.applyUrl='https://invented.example/apply',v=>v.job.salary.evidence='USD 999,000 / year',v=>v.job.salary.value='USD 999,000 / year',v=>v.runId='wrong',v=>v.job.extra='private',v=>v.job.company='']){
    const value=reply();edit(value);assert.throws(()=>validateJobCleanup(JSON.stringify(value),job(),'run-1'));
  }
  assert.throws(()=>validateJobCleanup('{incomplete',job(),'run-1'),/JSON/);
});
