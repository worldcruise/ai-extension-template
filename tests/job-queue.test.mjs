import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobQueue, applyGeneratedJobMetadata } from '../src/job-queue.mjs';
import { exampleProfile, parseProfile } from '../src/resume-data.mjs';

function memoryStore(initial = {}) {
  let state = structuredClone({ requests: [], profiles: [], control: {}, ...initial });
  let transaction = Promise.resolve();
  return { read: async () => structuredClone(state), change(mutator) {
    const result = transaction.then(() => {
      const draft = structuredClone(state), value = mutator(draft);
      state = draft; return { value, state: structuredClone(state) };
    });
    transaction = result.catch(() => {}); return result;
  } };
}
async function fixture(initial) {
  let id = 0, time = 100;
  const store = memoryStore(initial), queue = createJobQueue({ store, channel: null, uuid: () => `id-${++id}`, now: () => ++time });
  await queue.ready;
  const candidateId = await queue.importProfile(JSON.stringify(exampleProfile), 'Candidate.json');
  const input = { candidateId, profile: exampleProfile, tailor: true, job: { company: 'Northstar', role: 'Engineer',
    url: 'https://jobs.example.test/1', description: 'Build web applications.' }, resumeTemplate: 'kakuna', promptTemplate: 'focused' };
  return { queue, store, input };
}
const resumeFor = job => ({ company: job.input.job.company, title: exampleProfile.role, summary: exampleProfile.summary,
  skills: [{ Skills: exampleProfile.skills }], experience: exampleProfile.experience, education: exampleProfile.education });

test('corrected job details preserve older documents and update the save revision for the new documents', async () => {
  const {queue,store,input}=await fixture(), id=await queue.add(input);
  let job=queue.snapshot().requests.find(job=>job.id===id);
  await queue.saveDocuments(id,{resume:JSON.stringify(resumeFor(job)),expectedUpdatedAt:job.updatedAt});
  job=queue.snapshot().requests.find(job=>job.id===id);
  const run={id:'enrich-1',jobId:id,job,url:'https://chatgpt.com/c/cleaned-job',phase:'complete',documentSettings:{includeCoverLetter:false}};
  const details={...input.job,company:'Correct Employer',role:'Platform Engineer',description:'Clean responsibilities and requirements.',salary:'USD 100,000–130,000 / year',salarySource:'estimated'};
  const changed=await store.change(state=>applyGeneratedJobMetadata(state,run,details,200));
  await queue.refresh();
  assert.equal(queue.snapshot().requests.find(job=>job.id===id).state,'attention');
  assert.ok(changed.value.resume,'previous saved documents are retained');
  assert.equal(changed.value.resume.company,'Northstar');
  run.job=changed.value;run.result={resume:resumeFor(run.job),coverLetter:'',job:details};
  await queue.saveGeneratedDocuments(run);
  const saved=queue.snapshot().requests.find(job=>job.id===id);
  assert.equal(saved.state,'ready');assert.equal(saved.resume.company,'Correct Employer');assert.equal(saved.documentsStale,false);
  assert.equal(saved.input.job.role,'Platform Engineer');
  const repeated=await store.change(state=>applyGeneratedJobMetadata(state,{...run,job},details,500));
  assert.equal(repeated.value.updatedAt,200,'recovery retains the original metadata revision and cannot bypass later document edits');
  queue.dispose();
});

test('saving snapshots the job locally and exposes no runner or chat action API', async () => {
  const { queue, store, input } = await fixture();
  const id = await queue.add(input);
  input.job.description = 'Changed form';
  const job = (await store.read()).requests.find(job => job.id === id);
  assert.equal(job.input.job.description, 'Build web applications.');
  assert.equal(job.state, 'queued');
  for (const key of ['attempts', 'deliveryId', 'webChats', 'manualPreparations']) assert.equal(job[key], undefined);
  for (const key of ['start', 'pause', 'continueRequest', 'prepareManual', 'recordManualChat', 'generateAgain', 'retrySave']) assert.equal(queue[key], undefined);
  queue.dispose();
});

test('duplicate checks are atomic and candidate-scoped', async () => {
  const { queue, input } = await fixture();
  const results = await Promise.allSettled([queue.add(input, { checkExisting: true }), queue.add(input, { checkExisting: true })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'already-applied');
  const candidateId = await queue.importProfile(JSON.stringify({ ...exampleProfile, name: 'Another Candidate' }));
  await queue.add({ ...input, candidateId }, { checkExisting: true });
  assert.equal(queue.snapshot().requests.length, 2);
  await assert.rejects(queue.add(input, { checkExistingUrl: true }), { code: 'already-applied' });
  await queue.cancel(queue.snapshot().requests[0].id);
  await queue.add(input, { checkExisting: true });
  queue.dispose();
});

test('manual documents validate facts, save atomically and reject stale edits', async () => {
  const { queue, store, input } = await fixture();
  const id = await queue.add(input), job = queue.snapshot().requests[0];
  const draft = { resume: JSON.stringify(resumeFor(job)), coverLetterEnabled: true, coverLetter: 'My cover letter', expectedUpdatedAt: job.updatedAt };
  await assert.rejects(queue.saveDocuments(id, { ...draft, resume: '{}' }));
  assert.equal((await store.read()).requests[0].state, 'queued');
  await queue.saveDocuments(id, draft);
  assert.equal(queue.snapshot().requests[0].state, 'ready');
  assert.equal(queue.snapshot().requests[0].coverLetter, 'My cover letter');
  await assert.rejects(queue.saveDocuments(id, draft), /changed in another view/);
  await assert.rejects(queue.connect(id, 'javascript:alert(1)'));
  await queue.connect(id, 'https://chatgpt.com/c/saved?secret=removed');
  assert.equal(queue.snapshot().requests[0].manualChatUrl, 'https://chatgpt.com/c/saved');
  await queue.cancel(id);
  await assert.rejects(queue.saveDocuments(id, draft), /no longer/);
  queue.dispose();
});

test('existing saved data survives initialization without resuming old work', async () => {
  const legacy = { id: 'legacy', state: 'generating', attempts: [{ deliveryId: 'old' }], rawOutput: 'saved text', input: { candidateId: 'existing' } };
  const saved = { id: 'saved', state: 'saving', resume: { company: 'Saved' }, coverLetter: 'Keep this', input: { candidateId: 'existing' } };
  const { queue, store } = await fixture({ requests: [legacy, saved], control: { ownerId: 'old-runner', paused: false } });
  assert.deepEqual((await store.read()).requests, [legacy, saved]);
  assert.deepEqual(queue.snapshot().requests.map(job => job.state), ['attention', 'ready']);
  await queue.loadExamples();
  assert.deepEqual((await store.read()).requests.slice(0, 2), [legacy, saved]);
  assert.equal(queue.snapshot().requests.filter(job => job.isExample).length, 3);
  queue.dispose();
});

test('profile import validates shape and supported schema', () => {
  assert.equal(parseProfile(JSON.stringify(exampleProfile)).name, exampleProfile.name);
  for (const value of [{ ...exampleProfile, schemaVersion: 2 }, { ...exampleProfile, skills: 'not an array' }, { ...exampleProfile, name: '' }]) {
    assert.throws(() => parseProfile(JSON.stringify(value)));
  }
});

test('generated documents save atomically, mark the job Ready, and preserve their source conversation', async () => {
  for (const includeCoverLetter of [true, false]) {
    const {queue,store,input} = await fixture(), id = await queue.add(input), job = queue.snapshot().requests[0];
    const run = {id:'run-1',jobId:id,phase:'complete',job,documentSettings:{includeCoverLetter},
      url:'https://chat.deepseek.com/a/chat/s/saved?discard=secret', result:{resume:resumeFor(job),coverLetter:'Generated letter.'}};
    await Promise.all([queue.saveGeneratedDocuments(run),queue.saveGeneratedDocuments(run)]);
    const saved = (await store.read()).requests[0];
    assert.equal(saved.state,'ready'); assert.deepEqual(saved.resume, run.result.resume);
    assert.equal(saved.coverLetter, includeCoverLetter ? 'Generated letter.' : '');
    assert.equal(saved.coverLetterEnabled,includeCoverLetter); assert.equal(saved.documentRunId,run.id);
    assert.equal(saved.manualChatUrl,'https://chat.deepseek.com/a/chat/s/saved');
    assert.equal(saved.documentSaveSource,'automatic'); assert.ok(saved.documentSavedAt);
    await queue.saveGeneratedDocuments(run);
    assert.deepEqual((await store.read()).requests[0],saved,'repeating the automatic save does not change the job');
    await queue.saveDocuments(id,{resume:JSON.stringify({...resumeFor(job),summary:'Manually edited summary.'}),
      coverLetter:'My newer letter.',coverLetterEnabled:true,expectedUpdatedAt:saved.updatedAt});
    const edited = (await store.read()).requests[0];
    await queue.saveGeneratedDocuments(run);
    assert.deepEqual((await store.read()).requests[0],edited,'late automatic save cannot undo manual edits to this run');
    queue.dispose();
  }
});

test('automatic save rejects invalid results, changed jobs and cancelled jobs without overwriting documents', async () => {
  const {queue,store,input} = await fixture(), id = await queue.add(input), job = queue.snapshot().requests[0];
  const run = {id:'run-1',jobId:id,phase:'complete',job,result:{resume:resumeFor(job),coverLetter:'Generated letter.'}};
  await assert.rejects(queue.saveGeneratedDocuments({...run,phase:'invalid'}),/validated/);
  await assert.rejects(queue.saveGeneratedDocuments({...run,result:{...run.result,resume:{...run.result.resume,company:'Wrong company'}}}),/company does not match/);
  assert.equal((await store.read()).requests[0].resume,null);
  await queue.saveDocuments(id,{resume:JSON.stringify(resumeFor(job)),coverLetter:'My manual letter.',coverLetterEnabled:true,expectedUpdatedAt:job.updatedAt});
  const saved = (await store.read()).requests[0];
  await assert.rejects(queue.saveGeneratedDocuments(run),/changed in another view/);
  assert.deepEqual((await store.read()).requests[0],saved);
  await queue.cancel(id);
  await assert.rejects(queue.saveGeneratedDocuments(run),/no longer/);
  queue.dispose();
});

test('pending AI captures become one card only after cleanup, retain AI chat, and apply duplicate checks to cleaned data',async()=>{
  const {queue,input}=await fixture();
  const id=await queue.add({...input,job:{...input.job,company:'Noisy heading'}},{capturePending:true,checkExisting:true,checkExistingUrl:true});
  const pending=queue.snapshot().requests[0];assert.equal(pending.capturePending,true);
  const clean={...input,job:{...input.job,company:'Clean Employer',salary:'USD 100,000 / year',salarySource:'estimated',salaryBasis:'Candidate-based estimate.'}};
  const options={runId:'cleanup-run',sourceUrl:'https://chatgpt.com/c/cleaned',expectedUpdatedAt:pending.updatedAt};
  await Promise.all([queue.completeCapture(id,clean,options),queue.completeCapture(id,clean,options)]);
  const saved=queue.snapshot().requests[0];assert.equal(saved.capturePending,false);assert.equal(saved.input.job.company,'Clean Employer');
  assert.equal(saved.manualChatUrl,'https://chatgpt.com/c/cleaned');assert.equal(queue.snapshot().requests.length,1);
  const second=await queue.add({...input,job:{...input.job,url:'https://jobs.example.test/2'}},{capturePending:true,checkExisting:true});
  await assert.rejects(queue.completeCapture(second,clean),/Already applied/);
  assert.equal(queue.snapshot().requests.find(job=>job.id===second).capturePending,true);queue.dispose();
});
