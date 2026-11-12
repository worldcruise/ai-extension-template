import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJobCsv, importJobCsv } from '../src/job-csv.mjs';
import { createJobQueue } from '../src/job-queue.mjs';
import { exampleProfile } from '../src/resume-data.mjs';

test('CSV supports BOM, aliases, CRLF, Unicode, multiline descriptions and escaped quotes', () => {
  const result = parseJobCsv('\uFEFFCompany Name,Job Title,JD,Apply URL,Pay\r\n"Acme, Inc.",Engineer,"Build tools, APIs\r\nand ""reliable"" services.",https://jobs.example.test/1,€90000\r\n');
  assert.equal(result.errors.length,0); assert.equal(result.jobs.length,1);
  assert.equal(result.jobs[0].job.company,'Acme, Inc.');
  assert.equal(result.jobs[0].job.description,'Build tools, APIs\r\nand "reliable" services.');
  assert.equal(result.jobs[0].job.salary,'€90000');
});
test('bad rows are reported while valid rows survive; malformed structure rejects before any writes', () => {
  const result = parseJobCsv('company,title,description,url\nA,Engineer,Build,https://example.test/1\nB,Engineer,Build,javascript:alert(1)\nC,,Build,\nD,Engineer,Build,extra,broken');
  assert.equal(result.jobs.length,1); assert.equal(result.errors.length,3);
  for (const csv of ['company,title\nA,B','company,title,description\nA,B,"unclosed','company,title,description\nA,B,"closed"bad','company,company,title,description\nA,B,C,D']) assert.throws(()=>parseJobCsv(csv));
  assert.throws(()=>parseJobCsv('company,title,description\n'+Array(1001).fill('A,B,C').join('\n')),/1,000/);
  assert.throws(()=>parseJobCsv('x'.repeat(2000001)),/2 MB/);
});
test('CSV import uses real queue duplicate rules, candidate ownership and queued state', async () => {
  let data={requests:[],profiles:[],control:{}}, id=0;
  const store={read:async()=>structuredClone(data),change:async edit=>{const state=structuredClone(data),value=edit(state);data=state;return {state:structuredClone(state),value};}};
  const queue=createJobQueue({store,channel:null,uuid:()=>String(++id)}); await queue.ready;
  const candidateId=await queue.importProfile(JSON.stringify(exampleProfile));
  const input={candidateId,profile:exampleProfile,tailor:true,resumeTemplate:'kakuna',promptTemplate:'focused'};
  const source='company,title,description,url\nOne,Engineer,Build,https://jobs.example.test/1\nTwo,Engineer,Build,https://jobs.example.test/2\nOne,Engineer,Build,https://jobs.example.test/3\nBad,,Build,';
  const first=await importJobCsv(source,input,queue);assert.deepEqual([first.added,first.duplicates,first.invalid],[2,1,1]);
  const repeat=await importJobCsv(source,input,queue);assert.deepEqual([repeat.added,repeat.duplicates,repeat.invalid],[0,3,1]);
  assert.ok(data.requests.every(job=>job.state==='queued'&&job.input.candidateId===candidateId&&!job.resume));
  const other=await queue.importProfile(JSON.stringify(exampleProfile));
  assert.equal((await importJobCsv(source,{...input,candidateId:other},queue)).added,2);
  queue.dispose();
});
