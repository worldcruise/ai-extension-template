import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobQueue } from '../src/job-queue.mjs';
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
