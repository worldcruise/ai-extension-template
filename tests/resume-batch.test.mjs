import test from 'node:test';
import assert from 'node:assert/strict';
import { batchKey, createResumeBatch } from '../src/resume-batch.mjs';

function fixture() {
  const local = {}, calls = [], runs = [];
  const rows = [1,2,3].map(id => ({ id, sequence: id, state: 'queued', input: { candidateId: 'a' } }));
  rows.push({ id: 4, state: 'queued', input: { candidateId: 'b' } });
  const options = { browser: { storage: { local: { get: async () => structuredClone(local), set: async value => Object.assign(local, structuredClone(value)) } } },
    jobs: { read: async () => ({ requests: structuredClone(rows) }), change: async edit=>edit({requests:rows}) },
    generations: { list: async () => structuredClone(runs), stop:async id=>{const run=runs.find(run=>run.id===id);if(run)run.phase='stopped';},start: async (jobId, provider) => { calls.push([jobId,provider]); runs.push({ id:'run-'+jobId,jobId, kind: 'documents', phase: 'generating', documentSettings: { autoDownload: false } }); } } };
  return { options, batch: createResumeBatch(options), local, calls, runs, rows };
}
test('batch serializes queued jobs in order, survives worker replacement and ignores another candidate', async () => {
  const f = fixture(); await f.batch.start('a','deepseek');
  assert.deepEqual(f.calls, [[1,'deepseek']]);
  await assert.rejects(f.batch.start('a','deepseek'), /already running/);
  await Promise.all([f.batch.tick(), f.batch.tick()]); assert.equal(f.calls.length,1);
  const recovered = createResumeBatch(f.options);
  f.runs[0].phase = 'complete'; await recovered.tick(); assert.deepEqual(f.calls, [[1,'deepseek'],[2,'deepseek']]);
  f.runs[1].phase = 'complete'; await recovered.tick();
  f.runs[2].phase = 'complete'; await recovered.tick();
  assert.equal(f.local[batchKey].completed,3); assert.equal(f.local[batchKey].active,false);
  assert.equal(f.calls.length,3);
});
test('batch waits for delivery, marks failed jobs Need action and continues without resending', async () => {
  const f = fixture(); await f.batch.start('a','chatgpt');
  Object.assign(f.runs[0], { phase:'complete', documentSettings:{autoDownload:true} });
  await f.batch.tick(); assert.equal(f.calls.length,1);
  f.runs[0].downloads = {state:'downloading'}; await f.batch.tick(); assert.equal(f.calls.length,1);
  f.runs[0].downloads.state = 'complete'; await f.batch.tick(); assert.equal(f.calls.length,2);
  f.runs[1].phase = 'attention'; f.runs[1].error = 'Sign in first'; await f.batch.tick();
  assert.equal(f.local[batchKey].active,true); assert.equal(f.rows[1].needsAction,true);assert.equal(f.rows[1].error,'Sign in first');
  assert.equal(f.calls.length,3); assert.equal(f.local[batchKey].failed,1);
  await f.batch.tick(); assert.equal(f.calls.length,3);
  f.runs[2].phase='complete';await f.batch.tick();assert.equal(f.local[batchKey].active,false);
});
test('stop leaves the current run intact and cancelled or already prepared jobs are skipped', async () => {
  const f = fixture(); f.rows[1].resume = {}; await f.batch.start('a','chatgpt');
  f.rows[2].state = 'cancelled'; f.runs[0].phase = 'complete'; await f.batch.tick();
  assert.equal(f.calls.length,1); assert.equal(f.local[batchKey].skipped,1);
  const next = fixture(); await next.batch.start('a','deepseek'); await next.batch.stop();
  next.runs[0].phase = 'complete'; await next.batch.tick(); assert.equal(next.calls.length,1);
});
for(const phase of ['waiting-login','generating']) test(`batch continues past ${phase} when user action is needed`,async()=>{
  const f=fixture();await f.batch.start('a','deepseek');f.runs[0].phase=phase;
  if(phase==='generating')f.runs[0].trackingState='suspended';
  await f.batch.tick();assert.equal(f.calls.length,2);assert.equal(f.runs[0].phase,'stopped');assert.equal(f.rows[0].needsAction,true);
});
