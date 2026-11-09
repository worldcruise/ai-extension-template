import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResumePrompt, exampleProfile } from '../src/resume-data.mjs';
import { copyRequestPrompt, promptForManualCopy } from '../src/manual-prompt.mjs';

const request = () => ({ id: 'manual-request-1', state: 'queued', attempts: [], input: {
  candidateId: 'candidate-1', profile: structuredClone(exampleProfile), tailor: true,
  job: { company: 'Synthetic Company', role: 'Platform Engineer', description: 'Synthetic TypeScript and SQL job.', url: 'https://jobs.example.test/manual' },
  prompt: 'Use supported candidate facts.', resumeTemplate: 'kakuna', promptTemplate: 'focused'
} });

test('manual copy includes the complete immutable profile, job, instructions and output schema without changing the request', async () => {
  const item = request(), before = structuredClone(item), writes = [];
  await copyRequestPrompt(item, { writeText: async text => { writes.push(text); } });
  assert.equal(writes.length, 1);
  assert.equal(writes[0], buildResumePrompt(item, 'manual-manual-request-1'));
  assert.ok(writes[0].includes('CANDIDATE PROFILE:'));
  assert.ok(writes[0].includes('JOB REFERENCE:'));
  assert.ok(writes[0].includes(item.input.job.description));
  assert.ok(writes[0].includes(item.input.prompt));
  assert.deepEqual(item, before);
  assert.equal(promptForManualCopy(item), writes[0], 'repeated copies keep a stable marker without recording a delivery');
});

test('copying a prepared attempt preserves its exact prompt and delivery marker without new send evidence', async () => {
  const item = request(); item.deliveryId = 'prepared-delivery';
  const prompt = buildResumePrompt(item, item.deliveryId);
  item.attempts.push({ deliveryId: item.deliveryId, prompt, submitted: false });
  const before = structuredClone(item);
  assert.equal(promptForManualCopy(item), prompt);
  await copyRequestPrompt(item, { writeText: async value => assert.equal(value, prompt) });
  assert.deepEqual(item, before);
});

test('a prompt belonging to a different request is never used for manual copy', () => {
  const item = request(); item.deliveryId = 'prepared-delivery';
  item.attempts.push({ deliveryId: item.deliveryId, prompt: 'AI_AGENT_REQUEST:unrelated\n\nAI_AGENT_DELIVERY:prepared-delivery\n\nWrong prompt' });
  assert.equal(promptForManualCopy(item), buildResumePrompt(item, item.deliveryId));
});

test('clipboard failure leaves request state and delivery history unchanged', async () => {
  const item = request(), before = structuredClone(item);
  await assert.rejects(copyRequestPrompt(item, { writeText: async () => { throw new Error('Clipboard denied'); } }), /denied/);
  await assert.rejects(copyRequestPrompt(item, {}), /Clipboard is unavailable/);
  assert.deepEqual(item, before);
});
