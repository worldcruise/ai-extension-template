import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExtensionAuth, ISSUER, AUTHORIZE, TOKEN, JWKS, SCOPE, CALLBACK, RULE_ID, readCallback, transaction, verifyIdentity } from '../src/direct-oauth.mjs';

const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1) }, true, ['sign', 'verify']);
const publicKey = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'synthetic-key', use: 'sig', alg: 'RS256' };
const metadata = { issuer: ISSUER, authorization_endpoint: AUTHORIZE, token_endpoint: TOKEN, jwks_uri: JWKS, id_token_signing_alg_values_supported: ['RS256'], revocation_endpoint: ISSUER + '/oauth/revoke' };
const base64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
async function signed(claims, header = {}) {
  const body = base64({ alg: 'RS256', kid: 'synthetic-key', ...header }) + '.' + base64(claims);
  return body + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(body))).toString('base64url');
}
const claims = extra => ({ iss: ISSUER, aud: 'issued-test-client', sub: 'synthetic-user', nonce: 'nonce', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), ...extra });

function fixture(options = {}) {
  const local = {}, calls = [], rules = new Map(); let time = Date.now(), tabId = 42;
  const browser = {
    runtime: { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', getURL: path => 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' + path.replace(/^\//, '') },
    storage: { local: { async get(key) { return { [key]: local[key] }; }, async set(values) { Object.assign(local, structuredClone(values)); } } },
    declarativeNetRequest: { async updateSessionRules(change) { change.removeRuleIds?.forEach(id => rules.delete(id)); change.addRules?.forEach(rule => rules.set(rule.id, rule)); } },
    tabs: { async create() { return { id: tabId++ }; }, async update(id, data) { calls.push({ kind: 'navigation', id, url: data.url }); }, async remove() {} },
    alarms: { async create() {}, async clear() {} },
  };
  let auth;
  const fetchImpl = async (url, init) => {
    calls.push({ kind: 'fetch', url, form: init?.body ? Object.fromEntries(init.body) : null });
    if (url.endsWith('openid-configuration')) return Response.json({ ...metadata, ...options.metadata });
    if (url === JWKS) return Response.json({ keys: [publicKey] });
    if (url === metadata.revocation_endpoint) return new Response('', { status: options.revokeStatus || 200 });
    assert.equal(url, TOKEN);
    if (init.body.get('grant_type') === 'refresh_token') {
      if(options.refreshNetwork)throw new Error('Network unavailable');
      if(options.refreshExpired)return Response.json({error:{code:'SESSION_EXPIRED'}},{status:options.refreshExpired});
      if(options.refreshStatus)return Response.json({error:'temporarily_unavailable'},{status:options.refreshStatus});
      return Response.json({ token_type: 'Bearer', access_token: 'synthetic-rotated-access', refresh_token: 'synthetic-rotated-refresh', expires_in: 3600 });
    }
    return Response.json({ token_type: 'Bearer', access_token: 'synthetic-access-never-save', refresh_token: 'synthetic-refresh-never-save',
      id_token: await signed(claims({ nonce: auth.pending.nonce, ...options.claims })), scope: options.scope ?? SCOPE, expires_in: 3600 });
  };
  auth = new ExtensionAuth({ browser, fetchImpl, clock: () => time });
  const sender = () => ({ id: browser.runtime.id, url: browser.runtime.getURL('auth-callback.html'), frameId: 0, tab: { id: auth.pending?.tabId } });
  const query = () => new URLSearchParams({ code: 'synthetic-code-never-save', state: auth.pending.state, client_id: 'issued-test-client' }).toString();
  return { auth, browser, local, calls, rules, sender, query, advance(value) { time += value; } };
}

test('connect creates PKCE authorization and a callback rule scoped only to its own tab', async () => {
  const f = fixture(); assert.equal(await f.auth.status(), 'disconnected'); await f.auth.start();
  assert.equal(await f.auth.status(), 'connecting');
  const navigation = f.calls.find(call => call.kind === 'navigation'); const url = new URL(navigation.url);
  assert.equal(url.origin + url.pathname, AUTHORIZE); assert.equal(url.searchParams.get('redirect_uri'), CALLBACK);
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client'); assert.equal(url.searchParams.get('agent_name_hint'), 'AI Agent Template');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.notEqual(url.searchParams.get('code_challenge'), f.auth.pending.verifier);
  assert.deepEqual(f.rules.get(RULE_ID).condition.tabIds, [f.auth.pending.tabId]);
  assert.deepEqual(Object.keys(f.local['chatgpt-agent.registration']), ['hostId']);
});
test('verified callback connects; only host/client/subject mapping is stored, never credentials', async () => {
  const f = fixture(); await f.auth.start(); const sender = f.sender(), query = f.query(), verifier = f.auth.pending.verifier;
  await f.auth.callback(query, sender); assert.equal(await f.auth.status(), 'connected');
  assert.equal((await f.auth.session()).identityVerified, true); assert.equal(f.rules.size, 0);
  const tokenCall = f.calls.find(call => call.url === TOKEN); assert.equal(tokenCall.form.redirect_uri, CALLBACK); assert.equal(tokenCall.form.code_verifier, verifier);
  for (const secret of ['synthetic-access-never-save', 'synthetic-refresh-never-save', 'synthetic-code-never-save', verifier]) assert.ok(!JSON.stringify(f.local).includes(secret));
  await assert.rejects(f.auth.callback(query, sender), { code: 'callback_invalid' }); assert.equal(await f.auth.status(), 'connected');
});
test('wrong state, tab, subframe, client and duplicate callback parameters never exchange a code', async () => {
  for (const kind of ['state', 'tab', 'frame', 'duplicate', 'client']) {
    const f = fixture(); await f.auth.start(); const sender = f.sender(); const params = new URLSearchParams(f.query());
    if (kind === 'state') params.set('state', 'wrong');
    if (kind === 'tab') sender.tab.id++;
    if (kind === 'frame') sender.frameId = 1;
    if (kind === 'duplicate') params.append('code', 'second');
    if (kind === 'client') params.delete('client_id');
    await assert.rejects(f.auth.callback(params.toString(), sender)); assert.equal(f.calls.filter(call => call.url === TOKEN).length, 0);
  }
});
test('signed identity verifies signature, issuer, audience, expiry, nonce and account binding', async () => {
  const good = await signed(claims()); const keys = { keys: [publicKey] };
  assert.ok(await verifyIdentity(good, 'access', 'issued-test-client', 'nonce', keys));
  for (const change of [{ iss: 'https://wrong.invalid' }, { aud: 'wrong' }, { exp: 1 }, { iat: Math.floor(Date.now() / 1000) + 500 }, { nonce: 'wrong' }, { sub: '' }, { azp: 'wrong' }, { aud: ['issued-test-client', 'other'] }, { at_hash: 'wrong' }]) {
    await assert.rejects(verifyIdentity(await signed(claims(change)), 'access', 'issued-test-client', 'nonce', keys), { code: 'id_token_verification_failed' });
  }
  const pieces = good.split('.'); pieces[2] = base64('invalid-signature');
  await assert.rejects(verifyIdentity(pieces.join('.'), 'access', 'issued-test-client', 'nonce', keys), { code: 'id_token_verification_failed' });
  await assert.rejects(verifyIdentity(await signed(claims(), { alg: 'HS256' }), 'access', 'issued-test-client', 'nonce', keys), { code: 'id_token_verification_failed' });
  await assert.rejects(verifyIdentity(good, 'access', 'issued-test-client', 'nonce', keys, 'another-subject'), { code: 'selected_account_mismatch' });
});
test('identity failure and missing ChatGPT plan permission never create a connected session', async () => {
  for (const options of [{ claims: { nonce: 'wrong' } }, { scope: 'openid profile email' }]) {
    const f = fixture(options); await f.auth.start(); await assert.rejects(f.auth.callback(f.query(), f.sender()));
    assert.equal(await f.auth.status(), 'disconnected'); assert.equal(await f.auth.session(), null); assert.equal(f.rules.size, 0);
  }
});
test('return sign-in reuses this browser registration and rejects a different client or account', async () => {
  const f = fixture(); await f.auth.start(); await f.auth.callback(f.query(), f.sender()); const first = structuredClone(f.local['chatgpt-agent.registration']);
  await f.auth.disconnect(); await f.auth.start();
  const nav = f.calls.filter(call => call.kind === 'navigation').at(-1); const url = new URL(nav.url);
  assert.equal(url.searchParams.get('client_id'), first.clientId); assert.equal(url.searchParams.get('ext_agent_host_id'), first.hostId); assert.equal(url.searchParams.has('agent_name_hint'), false);
  const params = new URLSearchParams(f.query()); params.set('client_id', 'another-client'); await assert.rejects(f.auth.callback(params.toString(), f.sender()), { code: 'client_id_mismatch' });
});
test('refresh is serialized, rotates credentials, and disconnect revokes the latest refresh token', async () => {
  const f = fixture(); await f.auth.start(); await f.auth.callback(f.query(), f.sender()); f.advance(3595000);
  const [a, b] = await Promise.all([f.auth.session(), f.auth.session()]); assert.equal(a.accessToken, 'synthetic-rotated-access'); assert.equal(a, b);
  assert.equal(f.calls.filter(call => call.form?.grant_type === 'refresh_token').length, 1);
  assert.deepEqual(await f.auth.disconnect(), { revocationConfirmed: true });
  assert.equal(f.calls.at(-1).form.token, 'synthetic-rotated-refresh'); assert.equal(await f.auth.status(), 'disconnected');
});
test('revocation failure still clears local credentials and reports that remote revocation was not confirmed', async () => {
  const f = fixture({ revokeStatus: 503 }); await f.auth.start(); await f.auth.callback(f.query(), f.sender());
  assert.deepEqual(await f.auth.disconnect(), { revocationConfirmed: false }); assert.equal(await f.auth.session(), null);
});
test('timeout and cancellation remove callback interception without connecting', async () => {
  const f = fixture(); await f.auth.start(); f.advance(300001); assert.equal(await f.auth.status(), 'disconnected'); assert.equal(f.auth.error, 'authorization_timeout'); assert.equal(f.rules.size, 0);
  await f.auth.start(); await f.auth.finish('authorization_cancelled'); assert.equal(await f.auth.status(), 'disconnected'); assert.equal(f.rules.size, 0);
});
for(const options of [{refreshNetwork:true},{refreshStatus:403}])test('ordinary refresh failures retain the previously verified direct account',async()=>{
  const f=fixture(options);await f.auth.start();await f.auth.callback(f.query(),f.sender());const before=f.auth.credentials;f.advance(3595000);
  await assert.rejects(f.auth.session());assert.equal(f.auth.credentials,before);
});
test('direct refresh HTTP 401 expires credentials and never leaves a signed-in account',async()=>{
  const f=fixture({refreshStatus:401});await f.auth.start();await f.auth.callback(f.query(),f.sender());f.advance(3595000);
  await assert.rejects(f.auth.session(),{code:'SESSION_EXPIRED',status:401});assert.equal(f.auth.credentials,null);
});
for(const status of [200,403])test(`direct refresh expiry envelope on HTTP ${status} clears credentials`,async()=>{
  const f=fixture({refreshExpired:status});await f.auth.start();await f.auth.callback(f.query(),f.sender());f.advance(3595000);
  await assert.rejects(f.auth.session(),{code:'SESSION_EXPIRED',status:401});assert.equal(f.auth.credentials,null);
});
