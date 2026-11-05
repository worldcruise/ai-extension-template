import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler, runAgent } from '../src/server.mjs';
import { ChatGPTPlanProvider } from '../src/provider.mjs';
import { ProtocolError } from '../../src/protocol.mjs';

const body = { schemaVersion: 1, requestId: 'once', accountId: 'account-A', model: 'same-model', prompt: 'Prompt as instructions', input: 'Unmodified input', thinkingEffort: 'high' };
test('generic inference forwards separate prompt/input without adding context or enforcing output JSON', async () => {
  let request, calls = 0;
  const provider = { async models() { return [{ slug: 'same-model', thinkingEfforts: ['high'] }]; }, async infer(_token, value, report) { calls++; request = value; report.account_inference_confirmed = true; report.checks.response_completed = true; return '<b>Free-form output</b>'; } };
  assert.deepEqual(await runAgent({ body, token: 'session', provider }), { text: '<b>Free-form output</b>' });
  assert.deepEqual(request, { model: 'same-model', instructions: body.prompt, input: body.input, thinkingEffort: 'high' });
  await assert.rejects(runAgent({ body: { ...body, thinkingEffort: 'medium' }, token: 'session', provider }), { code: 'unsupported_thinking_effort' }); assert.equal(calls, 1);
});
test('reused provider sends input as text, uses supported effort, and keeps streaming completion checks', async () => {
  let sent;
  const provider = new ChatGPTPlanProvider({ async account() { return { access_token: 'TEST_ONLY' }; }, async fetch(_url, options) {
    sent = JSON.parse(options.body);
    return new Response('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: 'Plain output' }) + '\n\ndata: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [] } }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  const report = { checks: {}, counts: {} };
  assert.equal(await provider.infer('session', { model: 'same', instructions: 'Prompt', input: 'Input', thinkingEffort: 'high' }, report), 'Plain output');
  assert.deepEqual(sent.input, [{ role: 'user', content: 'Input' }]); assert.equal(sent.instructions, 'Prompt'); assert.deepEqual(sent.reasoning, { effort: 'high' }); assert.equal(sent.store, false); assert.equal(sent.stream, true);
  assert.equal(report.checks.response_completed, true);
});
async function setup(t, { slow = false, failure } = {}) {
  let calls = 0;
  const auth = { config: { extensionIds: ['a'.repeat(32)] }, availability: () => ({ available: true, code: 'ready' }), assertReady() {},
    async session(token) { if (token !== 'test-session') throw new ProtocolError('agent_authentication_required'); return { account: 'account-A' }; },
    async publicSession(token) { await this.session(token); return { authenticated: true, user: { id: 'account-A', name: 'Name' } }; }, async disconnect() { return { remoteRevocationConfirmed: true }; } };
  const provider = { async models() { return [{ slug: 'same-model', thinkingEfforts: ['high'] }]; }, async infer(_token, _request, report) {
    calls++; if (slow) await new Promise(resolve => setTimeout(resolve, 150)); if (failure) throw Object.assign(new ProtocolError(failure.code), { status: failure.status });
    report.account_inference_confirmed = true; report.checks.response_completed = true; return 'Actual adapter result';
  } };
  const server = http.createServer(createHandler({ auth, provider })); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const send = (path, value, headers = {}) => fetch('http://127.0.0.1:' + server.address().port + path, { method: value ? 'POST' : 'GET', headers: { 'x-forwarded-proto': 'https', Authorization: 'Bearer test-session', ...(value ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(value ? { body: JSON.stringify(value) } : {}) });
  return { send, get calls() { return calls; } };
}
test('generic HTTP route binds identity, deduplicates, and returns text without workflow data', async t => {
  const f = await setup(t);
  const response = await f.send('/v1/run', body); assert.equal(response.status, 200); const data = await response.json();
  assert.deepEqual(data, { schemaVersion: 1, requestId: body.requestId, text: 'Actual adapter result' });
  assert.equal((await f.send('/v1/run', body)).status, 409); assert.equal(f.calls, 1);
  assert.equal((await f.send('/v1/run', { ...body, requestId: 'wrong', accountId: 'B' })).status, 409); assert.equal(f.calls, 1);
  assert.equal((await f.send('/v1/run', { ...body, requestId: 'extra', candidate: {} })).status, 400);
});
test('generic host retains HTTPS, exact extension CORS and authentication boundaries', async t => {
  const f = await setup(t);
  assert.equal((await f.send('/v1/status', null, { 'x-forwarded-proto': 'http' })).status, 503);
  assert.equal((await f.send('/v1/status', null, { Origin: 'https://attacker.test' })).status, 403);
  assert.equal((await f.send('/v1/models', null, { Authorization: 'Bearer invalid' })).status, 401);
  const status = await (await f.send('/v1/status', null, { Origin: 'chrome-extension://' + 'a'.repeat(32) })).json(); assert.equal(status.session.user.id, 'account-A');
});
test('slow inference retains heartbeat framing and HTTP 200 expiry envelopes clear clients', async t => {
  const f = await setup(t, { slow: true, failure: { code: 'SESSION_EXPIRED', status: 401 } });
  const response = await f.send('/v1/run', body); assert.equal(response.status, 200); assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const data = await response.json(); assert.equal(data.error.code, 'SESSION_EXPIRED'); assert.equal(f.calls, 1);
});
