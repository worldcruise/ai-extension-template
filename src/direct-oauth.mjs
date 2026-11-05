import { ProtocolError as AgentError } from './protocol.mjs';

export const ISSUER = 'https://auth.openai.com';
export const AUTHORIZE = ISSUER + '/api/accounts/authorize';
export const TOKEN = ISSUER + '/api/accounts/oauth/token';
export const JWKS = ISSUER + '/.well-known/jwks.json';
export const RESOURCE = 'https://api.openai.com/v1';
export const BOOTSTRAP = 'dynamic_agent_client';
export const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const RULE_ID = 74001;
export const CALLBACK = 'http://127.0.0.1:1455/auth/callback';
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export const sha256 = async value => encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
const fail = (code, stage = 'authorization') => { throw new AgentError(code, stage); };
const issued = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value !== BOOTSTRAP;

export async function transaction(registration, now = Date.now()) {
  return { clientId: registration.clientId || BOOTSTRAP, hostId: registration.hostId, previousSubject: registration.subjectHash,
    state: random(), nonce: random(), verifier: random(), redirectUri: CALLBACK, expiresAt: now + 300000, tabId: null, consuming: false };
}
export async function authorizationUrl(attempt) {
  const params = new URLSearchParams({ client_id: attempt.clientId, ext_agent_host_id: attempt.hostId,
    response_type: 'code', redirect_uri: attempt.redirectUri, scope: SCOPE, resource: RESOURCE,
    state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: await sha256(attempt.verifier) });
  if (attempt.clientId === BOOTSTRAP) params.set('agent_name_hint', 'AI Agent Template');
  return AUTHORIZE + '?' + params;
}
export function callbackRule(runtimeId, tabId) {
  return { id: RULE_ID, priority: 1,
    action: { type: 'redirect', redirect: { regexSubstitution: `chrome-extension://${runtimeId}/auth-callback.html\\1` } },
    condition: { regexFilter: '^http://127\\.0\\.0\\.1:1455/auth/callback(\\?.*)$', isUrlFilterCaseSensitive: true, resourceTypes: ['main_frame'], tabIds: [tabId] } };
}
export function readCallback(query, attempt, senderTab, now = Date.now()) {
  if (!attempt || attempt.tabId !== senderTab || attempt.expiresAt <= now || attempt.consuming) fail('callback_invalid', 'callback');
  if (typeof query !== 'string' || query.length > 16384) fail('callback_invalid', 'callback');
  const params = new URLSearchParams(query);
  if (params.getAll('state').length !== 1 || params.get('state') !== attempt.state) fail('state_mismatch', 'callback');
  for (const key of new Set(params.keys())) if (params.getAll(key).length !== 1) fail('duplicate_callback_parameter', 'callback');
  if (params.has('error')) fail(['access_denied', 'invalid_client', 'unauthorized_client', 'invalid_scope'].includes(params.get('error')) ? params.get('error') : 'authorization_failed');
  const code = params.get('code'), returned = params.get('client_id');
  if (!code) fail('missing_authorization_code', 'callback');
  if (attempt.clientId === BOOTSTRAP && !issued(returned)) fail('missing_issued_client_id', 'callback');
  if (attempt.clientId !== BOOTSTRAP && returned && returned !== attempt.clientId) fail('client_id_mismatch', 'callback');
  return { code, clientId: attempt.clientId === BOOTSTRAP ? returned : attempt.clientId };
}
function decode(part) {
  if (!/^[\w-]+$/.test(part)) throw new Error();
  return Uint8Array.from(atob(part.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
export async function verifyIdentity(token, accessToken, clientId, nonce, keys, previousSubject, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 32768) throw new Error();
    const segments = token.split('.'); if (segments.length !== 3) throw new Error();
    const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(segments[0])));
    const claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(segments[1])));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.crit) throw new Error();
    const matches = (keys?.keys || []).filter(key => key.kid === header.kid && key.kty === 'RSA' && (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'RS256'));
    if (matches.length !== 1) throw new Error();
    const key = await crypto.subtle.importKey('jwk', matches[0], { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(segments[2]), new TextEncoder().encode(segments[0] + '.' + segments[1]))) throw new Error();
    const audience = claims.aud;
    if (claims.iss !== ISSUER || !(audience === clientId || Array.isArray(audience) && audience.includes(clientId)) ||
        !Number.isInteger(claims.exp) || claims.exp <= now / 1000 - 5 || !Number.isInteger(claims.iat) || claims.iat > now / 1000 + 5 ||
        typeof claims.sub !== 'string' || !claims.sub || nonce != null && claims.nonce !== nonce ||
        claims.azp !== undefined && claims.azp !== clientId || Array.isArray(audience) && audience.length > 1 && claims.azp !== clientId) throw new Error();
    if (claims.at_hash !== undefined && claims.at_hash !== encode((await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken))).slice(0, 16))) throw new Error();
    const subjectHash = await sha256(claims.sub);
    if (previousSubject && previousSubject !== subjectHash) fail('selected_account_mismatch', 'identity');
    return subjectHash;
  } catch (error) { if (error?.code === 'selected_account_mismatch') throw error; fail('id_token_verification_failed', 'identity'); }
}

export class ExtensionAuth {
  constructor({ browser, fetchImpl = globalThis.fetch, clock = () => Date.now() }) {
    this.browser = browser; this.fetch = fetchImpl.bind(globalThis); this.clock = clock;
    // Credentials and PKCE state live only in this worker's memory. No browser
    // storage, page messages, diagnostics, or files receive any token.
    this.credentials = null; this.pending = null; this.error = null; this.refreshing = null;
    this.ready = browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] });
  }
  async json(url, stage, form) {
    let response;
    try { response = await this.fetch(url, { redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(25000),
      headers: form ? { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } : { Accept: 'application/json' },
      ...(form ? { method: 'POST', body: new URLSearchParams(form) } : {}) }); }
    catch { fail('connection_error', stage); }
    if (response.status === 401) { await response.body?.cancel(); throw Object.assign(new AgentError('SESSION_EXPIRED'), { status: 401, stage }); }
    let data;
    try { const body = await response.text(); if (body.length > 2 * 1024 * 1024) throw new Error(); data = JSON.parse(body); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); }
    catch { fail('authorization_failed', stage); }
    if (['SESSION_EXPIRED', 'session_expired'].includes(typeof data.error === 'string' ? data.error : data.error?.code)) {
      throw Object.assign(new AgentError('SESSION_EXPIRED'), { status: 401, stage });
    }
    if (!response.ok) { const code = typeof data.error === 'string' ? data.error : data.error?.code;
      throw Object.assign(new AgentError(response.status === 401 ? 'SESSION_EXPIRED' : ['invalid_grant', 'invalid_client', 'unauthorized_client', 'access_denied', 'invalid_scope'].includes(code) ? code : 'authorization_failed'), { status: response.status, stage }); }
    return data;
  }
  async metadata() {
    const data = await this.json(ISSUER + '/.well-known/openid-configuration', 'discovery');
    if (data.issuer !== ISSUER || data.authorization_endpoint !== AUTHORIZE || data.token_endpoint !== TOKEN || data.jwks_uri !== JWKS ||
      !data.id_token_signing_alg_values_supported?.includes('RS256')) fail('unexpected_provider_configuration', 'discovery');
    const revoke = data.revocation_endpoint;
    if (typeof revoke === 'string' && new URL(revoke).origin === ISSUER) this.revocationEndpoint = revoke;
    return data;
  }
  async registration() {
    const key = 'chatgpt-agent.registration';
    let record = (await this.browser.storage.local.get(key))[key];
    if (!record) { record = { hostId: 'urn:uuid:' + crypto.randomUUID() }; await this.browser.storage.local.set({ [key]: record }); }
    if (!/^urn:uuid:[a-f0-9-]{36}$/.test(record.hostId) || record.clientId && !issued(record.clientId)) fail('invalid_session');
    return record;
  }
  async status() {
    await this.ready;
    if (this.pending?.expiresAt <= this.clock()) await this.finish('authorization_timeout');
    if (this.pending) return 'connecting';
    if (this.credentials && this.credentials.expiresAt <= this.clock() && !this.credentials.refreshToken) { this.credentials = null; this.error = 'session_expired'; }
    if (this.credentials && this.credentials.expiresAt <= this.clock() && this.credentials.refreshToken) {
      try { await this.session(); } catch (error) { if (!this.credentials) return 'disconnected'; throw error; }
    }
    return this.credentials ? 'connected' : 'disconnected';
  }
  async start() {
    await this.ready;
    if (await this.status() === 'connected' || this.pending) return;
    this.error = null;
    await this.metadata();
    const registration = await this.registration();
    const attempt = await transaction(registration, this.clock());
    let tab;
    try {
      tab = await this.browser.tabs.create({ url: 'about:blank', active: true });
      attempt.tabId = tab.id; this.pending = attempt;
      await this.browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID], addRules: [callbackRule(this.browser.runtime.id, tab.id)] });
      await this.browser.alarms.create('chatgpt-agent.authorization', { when: attempt.expiresAt });
      await this.browser.tabs.update(tab.id, { url: await authorizationUrl(attempt) });
    } catch { await this.finish('callback_setup_failed'); if (tab) await this.browser.tabs.remove(tab.id).catch(() => {}); fail('callback_setup_failed'); }
  }
  async finish(error = null) {
    this.pending = null; this.error = error;
    await this.browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] });
    await this.browser.alarms.clear('chatgpt-agent.authorization');
  }
  async callback(query, sender) {
    const attempt = this.pending;
    let senderUrl; try { senderUrl = new URL(sender.url); } catch { fail('callback_invalid', 'callback'); }
    if (sender.id !== this.browser.runtime.id || senderUrl.protocol !== 'chrome-extension:' || senderUrl.hostname !== this.browser.runtime.id || senderUrl.pathname !== '/auth-callback.html' || sender.frameId !== 0) fail('callback_invalid', 'callback');
    let value;
    try { value = readCallback(query, attempt, sender.tab?.id, this.clock()); }
    catch (error) { if (attempt?.tabId === sender.tab?.id && error.code !== 'state_mismatch' && !attempt.consuming) await this.finish(error.code); throw error; }
    attempt.consuming = true;
    try {
      const registration = await this.registration();
      // Preserve this installation's issued registration even if code exchange fails.
      await this.browser.storage.local.set({ 'chatgpt-agent.registration': { ...registration, clientId: value.clientId } });
      const tokens = await this.json(TOKEN, 'token_exchange', { grant_type: 'authorization_code', client_id: value.clientId, code: value.code,
        code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE });
      if (tokens.token_type?.toLowerCase() !== 'bearer' || typeof tokens.access_token !== 'string' || !tokens.access_token || typeof tokens.id_token !== 'string') fail('invalid_session', 'token_exchange');
      const subjectHash = await verifyIdentity(tokens.id_token, tokens.access_token, value.clientId, attempt.nonce, await this.json(JWKS, 'jwks'), attempt.previousSubject, this.clock());
      if (typeof tokens.scope !== 'string' || !tokens.scope.split(' ').includes('chatgpt.tokens.use.direct')) fail('chatgpt_plan_scope_not_granted', 'permission');
      if (this.pending !== attempt) fail('authorization_cancelled');
      await this.browser.storage.local.set({ 'chatgpt-agent.registration': { hostId: registration.hostId, clientId: value.clientId, subjectHash } });
      if (this.pending !== attempt) fail('authorization_cancelled');
      const claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(tokens.id_token.split('.')[1])));
      const displayName = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0,120)
        : typeof claims.email === 'string' && claims.email.trim() ? claims.email.trim().slice(0,120) : 'ChatGPT account';
      this.credentials = this.tokenSet(tokens, { clientId: value.clientId, subjectHash, displayName });
      await this.finish();
    } catch (error) { if (this.pending === attempt) { this.credentials = null; await this.finish(error.code || 'authorization_failed'); } throw error; }
  }
  tokenSet(tokens, previous) {
    return { ...previous, accessToken: tokens.access_token, refreshToken: tokens.refresh_token || previous.refreshToken,
      identityVerified: true, scope: tokens.scope || previous.scope,
      expiresAt: this.clock() + (Number.isFinite(tokens.expires_in) && tokens.expires_in > 0 ? tokens.expires_in : 300) * 1000 };
  }
  async session() {
    if (!this.credentials) return null;
    if (this.credentials.expiresAt > this.clock() + 10000) return this.credentials;
    if (!this.credentials.refreshToken) { this.credentials = null; this.error = 'session_expired'; return null; }
    if (!this.refreshing) this.refreshing = this.refresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async refresh() {
    const old = this.credentials;
    try {
      const tokens = await this.json(TOKEN, 'token_exchange', { grant_type: 'refresh_token', client_id: old.clientId, refresh_token: old.refreshToken, resource: RESOURCE });
      if (tokens.token_type?.toLowerCase() !== 'bearer' || typeof tokens.access_token !== 'string' || !tokens.access_token) fail('invalid_session');
      if (tokens.scope !== undefined && !tokens.scope.split(' ').includes('chatgpt.tokens.use.direct')) fail('chatgpt_plan_scope_not_granted', 'permission');
      if (tokens.id_token) await verifyIdentity(tokens.id_token, tokens.access_token, old.clientId, null, await this.json(JWKS, 'jwks'), old.subjectHash, this.clock());
      if (this.credentials !== old) fail('authorization_cancelled');
      this.credentials = this.tokenSet(tokens, old); return this.credentials;
    } catch (error) {
      if (this.credentials === old && (error.status === 401 || ['SESSION_EXPIRED','invalid_grant','invalid_session','id_token_verification_failed','chatgpt_plan_scope_not_granted'].includes(error.code))) {
        this.credentials = null; this.error = 'session_expired';
        throw Object.assign(new AgentError('SESSION_EXPIRED'), { status: 401 });
      }
      throw error;
    }
  }
  async disconnect() {
    const old = this.credentials; this.credentials = null;
    await this.finish();
    let revocationConfirmed = !old?.refreshToken;
    if (old?.refreshToken) {
      try {
        if (!this.revocationEndpoint) await this.metadata();
        if (!this.revocationEndpoint) throw new Error();
        const response = await this.fetch(this.revocationEndpoint, { method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(25000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: old.refreshToken, token_type_hint: 'refresh_token', client_id: old.clientId }) });
        revocationConfirmed = response.status === 200;
      } catch { revocationConfirmed = false; }
    }
    return { revocationConfirmed };
  }
}
