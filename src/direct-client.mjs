import { ExtensionAuth, RESOURCE, sha256 } from './direct-oauth.mjs';
import { ProtocolError, strictJson } from './protocol.mjs';
import { consumeResponse, outputDiagnostics } from './response-stream.mjs';
import { isSessionExpired } from './controller.mjs';

// Reuses the feasibility extension's browser-owned registration/callback flow.
// Provider credentials stay in this worker; the public session contains identity only.
export class DirectClient {
  constructor({ browser, auth = new ExtensionAuth({ browser }), fetchImpl = globalThis.fetch }) {
    this.browser = browser; this.auth = auth; this.fetch = fetchImpl.bind(globalThis);
    this.generation = 0; this.operation = 0; this.accountId = null;
  }
  get token() { return this.auth.credentials?.accessToken || null; }
  set token(value) { if (value === null) { this.auth.credentials = null; this.auth.error = 'session_expired'; this.accountId = null; ++this.generation; ++this.operation; } }
  async verified() {
    const operation=this.operation;
    let credentials;
    try { credentials = await this.auth.session(); }
    catch (error) { if (isSessionExpired(error)) this.token = null; throw error; }
    if (!credentials) { if (this.accountId) { this.accountId = null; ++this.generation; } return null; }
    if (credentials.identityVerified !== true || !credentials.accessToken || !credentials.scope?.split(/\s+/).includes('chatgpt.tokens.use.direct')) {
      this.token = null; throw Object.assign(new ProtocolError('SESSION_EXPIRED'), { status: 401 });
    }
    const id = 'account_' + await sha256(credentials.clientId + '\0' + credentials.subjectHash);
    if(operation!==this.operation||this.auth.credentials!==credentials)throw new ProtocolError('cancelled');
    if (id !== this.accountId) { this.accountId = id; ++this.generation; }
    return { credentials, session: { authenticated: true, user: { id, name: credentials.displayName || 'ChatGPT account' }, expiresAt: credentials.expiresAt } };
  }
  async status() {
    await this.auth.ready;
    if (this.auth.pending?.expiresAt <= this.auth.clock()) await this.auth.finish('authorization_timeout');
    const verified = await this.verified();
    return { reachable: true, signInAvailable: true, signedIn: !!verified, session: verified?.session || null, reason: 'ready', connecting: !!this.auth.pending };
  }
  async connect() {
    const operation = ++this.operation; ++this.generation;
    await this.auth.start();
    while (this.auth.pending) {
      if (operation !== this.operation) throw new ProtocolError('cancelled');
      await this.auth.status();
      if (this.auth.pending) await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (operation !== this.operation) throw new ProtocolError('cancelled');
    if (this.auth.error) throw new ProtocolError(this.auth.error);
    const status = await this.status();
    if (!status.signedIn) throw new ProtocolError('authorization_cancelled');
    return status;
  }
  async disconnect() {
    const operation=++this.operation; ++this.generation;
    const result = await this.auth.disconnect();
    if(operation!==this.operation)throw new ProtocolError('cancelled');
    this.accountId = null;
    return result;
  }
  async authorized(path, { signal, body } = {}) {
    const verified = await this.verified();
    if (!verified) throw Object.assign(new ProtocolError('SESSION_EXPIRED'), { status: 401 });
    const { credentials, session } = verified, generation = this.generation;
    let response;
    try {
      response = await this.fetch(RESOURCE + path, { method: body ? 'POST' : 'GET', signal,
        redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { Authorization: 'Bearer ' + credentials.accessToken, ...(body ? { 'Content-Type': 'application/json', Accept: 'text/event-stream' } : { Accept: 'application/json' }) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new ProtocolError(signal?.aborted ? 'cancelled' : 'connection_error'); }
    const current = () => generation === this.generation && session.user.id === this.accountId && !!this.auth.credentials && !signal?.aborted;
    if (!current()) { await response.body?.cancel(); throw new ProtocolError('cancelled'); }
    if (response.status === 401) {
      await response.body?.cancel();
      if (this.auth.credentials.accessToken !== credentials.accessToken) throw new ProtocolError('cancelled');
      this.token = null; throw Object.assign(new ProtocolError('SESSION_EXPIRED'), { status: 401 });
    }
    if (!response.ok) {
      let expired = false;
      try { await consumeResponse(response, { response_diagnostics: {}, output_diagnostics: outputDiagnostics() }); }
      catch (error) { expired = isSessionExpired(error); }
      if (!current()) throw new ProtocolError('cancelled');
      if (expired) {
        if (this.auth.credentials.accessToken !== credentials.accessToken) throw new ProtocolError('cancelled');
        this.token = null; throw Object.assign(new ProtocolError('SESSION_EXPIRED'), { status: 401 });
      }
      throw Object.assign(new ProtocolError('provider_request_failed'), { status: response.status });
    }
    return { response, current };
  }
  async models(signal) {
    const { response, current } = await this.authorized('/models', { signal });
    let text = '', size = 0; const decoder = new TextDecoder('utf-8', { fatal: true });
    for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new ProtocolError('invalid_agent_response'); text += decoder.decode(chunk, { stream: true }); }
    text += decoder.decode(); if (!current()) throw new ProtocolError('cancelled');
    const data = strictJson(text);
    if (isSessionExpired({code:data.error?.code})) { this.token=null;throw Object.assign(new ProtocolError('SESSION_EXPIRED'),{status:401}); }
    if (!Array.isArray(data.models)) throw new ProtocolError('unexpected_catalog_shape');
    const models = data.models.filter(row => row?.visibility === 'list' && typeof row.slug === 'string' && row.slug.length > 0 && row.slug.length <= 128).map(row => {
      const levels = Array.isArray(row.supported_reasoning_levels) ? row.supported_reasoning_levels : [];
      const thinkingEfforts = [...new Set(levels.map(level => level?.effort).filter(effort => typeof effort === 'string' && /^[a-z]{1,20}$/.test(effort)))];
      return { slug: row.slug, display_name: typeof row.display_name === 'string' ? row.display_name.slice(0,120) : row.slug, thinkingEfforts,
        ...(thinkingEfforts.includes(row.default_reasoning_level) ? { defaultThinkingEffort: row.default_reasoning_level } : {}) };
    });
    if (!models.length) throw new ProtocolError('no_available_models');
    return { accountId: this.accountId, models };
  }
  async request(path, { body, signal } = {}) {
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000);
    if (path === '/v1/models') return this.models(requestSignal);
    if (path !== '/v1/run') throw new ProtocolError('invalid_request');
    const verified = await this.verified();
    if (!verified) throw Object.assign(new ProtocolError('SESSION_EXPIRED'), { status: 401 });
    if (body.accountId !== verified.session.user.id) throw new ProtocolError('account_changed');
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 40000 || typeof body.input !== 'string' || !body.input.trim() || body.input.length > 40000) throw new ProtocolError('invalid_input');
    const catalog = await this.models(requestSignal), model = catalog.models.find(row => row.slug === body.model);
    if (catalog.accountId !== body.accountId) throw new ProtocolError('account_changed');
    if (!model) throw new ProtocolError('requested_model_not_available');
    if (body.thinkingEffort && !model.thinkingEfforts.includes(body.thinkingEffort)) throw new ProtocolError('unsupported_thinking_effort');
    const { response, current } = await this.authorized('/responses', { signal: requestSignal, body: {
      model: model.slug, instructions: body.prompt, input: [{ role: 'user', content: body.input }],
      ...(body.thinkingEffort ? { reasoning: { effort: body.thinkingEffort } } : {}), store: false, stream: true,
    } });
    const report = { checks: {}, response_diagnostics: {}, output_diagnostics: outputDiagnostics() };
    try {
      const text = await consumeResponse(response, report);
      if (!current()) throw new ProtocolError('cancelled');
      return { text };
    } catch (error) {
      if (!current()) throw new ProtocolError('cancelled');
      if (isSessionExpired(error)) this.token = null;
      throw error;
    }
  }
}
