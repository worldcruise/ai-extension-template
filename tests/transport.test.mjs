import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentClient, agentUrl } from '../src/hosted-client.mjs';
import { strictJson } from '../src/protocol.mjs';

test('hosted sign-in retains callback state/PKCE and only keeps its agent token in RAM', async () => {
  const requests = [], browser = { identity: { getRedirectURL: () => 'https://' + 'a'.repeat(32) + '.chromiumapp.org/agent',
    async launchWebAuthFlow({ url }) { const request = new URL(url), callback = new URL(request.searchParams.get('redirect_uri')); assert.ok(request.searchParams.get('code_challenge')); callback.search = new URLSearchParams({ state: request.searchParams.get('state'), code: 'TEST_CODE' }); return callback.href; } } };
  const client = new AgentClient({ browser, baseUrl: 'https://agent.test', fetchImpl: async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/auth/exchange')) { const body = JSON.parse(options.body); assert.equal(body.code, 'TEST_CODE'); assert.ok(body.verifier); return Response.json({ schemaVersion: 1, token: 'a'.repeat(43) }); }
    return Response.json({ schemaVersion: 1, signInAvailable: true, signedIn: !!options.headers.Authorization });
  } });
  assert.equal((await client.connect()).signedIn, true); assert.equal(client.token, 'a'.repeat(43));
  assert.equal(requests[0].options.redirect, 'error'); assert.equal(requests[0].options.credentials, 'omit'); await client.disconnect(); assert.equal(client.token, null);
});
test('HTTPS-origin validation and forged callbacks fail before exchanging a code', async () => {
  for (const url of ['http://localhost', 'https://user:secret@agent.test', 'https://agent.test/path', 'https://agent.test/?secret=x']) assert.throws(() => agentUrl(url));
  let exchanged = false;
  const client = new AgentClient({ baseUrl: 'https://agent.test', browser: { identity: { getRedirectURL: () => 'https://' + 'a'.repeat(32) + '.chromiumapp.org/agent', launchWebAuthFlow: async () => 'https://' + 'a'.repeat(32) + '.chromiumapp.org/agent?state=forged&code=x' } }, fetchImpl: async url => { exchanged ||= url.endsWith('/auth/exchange'); return Response.json({ schemaVersion: 1, signInAvailable: true }); } });
  await assert.rejects(client.connect(), { code: 'invalid_callback' }); assert.equal(exchanged, false);
});
test('strict transport JSON rejects duplicate/escaped keys and deep nesting', () => {
  assert.throws(() => strictJson('{"a":1,"\\u0061":2}'), { code: 'duplicate_json_key' });
  assert.throws(() => strictJson('['.repeat(81) + '0' + ']'.repeat(81)), { code: 'json_too_deep' });
  assert.deepEqual(strictJson('{"a":[true,null]}'), { a: [true, null] });
});
