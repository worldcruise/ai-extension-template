import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { ProtectedStore } from './secrets.mjs';
import { HostedSignIn } from './siwc.mjs';
import { ChatGPTPlanProvider } from './provider.mjs';
import { ProtocolError, strictJson } from '../../src/protocol.mjs';

export function configuration(env = process.env) {
  return { publicUrl: env.PUBLIC_BASE_URL || '', redirectUri: env.SIWC_REDIRECT_URI || '', clientId: env.SIWC_CLIENT_ID || '',
    clientSecret: env.SIWC_CLIENT_SECRET || '', tokenAuthMethod: env.SIWC_TOKEN_AUTH_METHOD || 'none', hostId: env.SIWC_HOST_ID || '',
    planUsageApproved: env.SIWC_PLAN_USAGE_APPROVED === 'true', extensionIds: (env.ALLOWED_EXTENSION_IDS || '').split(',').filter(id => /^[a-p]{32}$/.test(id)) };
}
const expired = error => error.status === 401 || ['agent_authentication_required', 'provider_authorization_expired', 'SESSION_EXPIRED', 'authentication_error'].includes(error.code);
const allowedCodes = new Set(['hosted_deployment_not_configured', 'hosted_plan_registration_required', 'approved_https_callback_required',
  'credential_storage_unavailable', 'stable_host_id_required', 'unsupported_client_configuration', 'extension_registration_required',
  'invalid_extension_callback', 'invalid_authorization_request', 'authorization_capacity_reached', 'authorization_expired', 'authorization_declined',
  'invalid_callback', 'invalid_token_response', 'id_token_verification_failed', 'chatgpt_plan_scope_not_granted', 'invalid_agent_code',
  'agent_authentication_required', 'provider_authorization_expired', 'provider_request_failed', 'provider_connection_error', 'provider_invalid_response',
  'no_available_models', 'secure_transport_required', 'origin_not_allowed', 'json_content_type_required', 'request_too_large', 'invalid_request',
  'invalid_json', 'duplicate_json_key', 'json_too_deep', 'request_already_used', 'request_in_progress', 'request_capacity_reached', 'account_changed',
  'SESSION_EXPIRED', 'authentication_error', 'unsupported_thinking_effort', 'requested_model_not_available', 'invalid_input', 'cancelled',
  'model_refusal', 'empty_output', 'response_incomplete', 'invalid_completion_event', 'stream_ended_without_completion', 'invalid_stream_json',
  'stream_too_large', 'subscription_sharing_usage_limit_exceeded', 'subscription_sharing_usage_unavailable', 'rate_limit_exceeded', 'request_failed', 'provider_error']);
const safeCode = error => expired(error) ? 'SESSION_EXPIRED' : allowedCodes.has(error.code) ? error.code : 'agent_request_failed';

export async function runAgent({ body, token, provider, signal }) {
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 40000 ||
      typeof body.input !== 'string' || !body.input.trim() || body.input.length > 40000) throw new ProtocolError('invalid_input');
  const models = await provider.models(token), selected = models.find(model => model.slug === body.model);
  if (!selected) throw new ProtocolError('requested_model_not_available');
  if (body.thinkingEffort !== undefined && !selected.thinkingEfforts?.includes(body.thinkingEffort)) throw new ProtocolError('unsupported_thinking_effort');
  const report = { checks: {}, counts: {} };
  const text = await provider.infer(token, { model: selected.slug, instructions: body.prompt, input: body.input,
    ...(body.thinkingEffort ? { thinkingEffort: body.thinkingEffort } : {}) }, report, signal);
  if (report.account_inference_confirmed !== true || report.checks.response_completed !== true) throw new ProtocolError('invalid_completion_event');
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024) throw new ProtocolError('stream_too_large');
  return { text };
}

export function createHandler({ auth, provider, requireHttps = true, run = runAgent }) {
  const used = new Map(), inflight = new Set();
  return async function handler(request, response) {
    const controller = new AbortController(); response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" };
    const send = (status, data) => { if (response.destroyed) return; if (!response.headersSent) response.writeHead(status, headers); response.end(JSON.stringify({ schemaVersion: 1, ...data })); };
    let heartbeat, interval;
    try {
      if (requireHttps && request.headers['x-forwarded-proto'] !== 'https') throw new ProtocolError('secure_transport_required');
      if (request.headers.origin) {
        if (!auth.config.extensionIds.some(id => request.headers.origin === 'chrome-extension://' + id)) throw new ProtocolError('origin_not_allowed');
        headers['Access-Control-Allow-Origin'] = request.headers.origin; headers.Vary = 'Origin';
      }
      if (request.method === 'OPTIONS') { response.writeHead(204, { ...headers, 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); response.end(); return; }
      const url = new URL(request.url, 'https://agent.invalid'), token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.authorization || '')?.[1];
      if (url.pathname === '/v1/status' && request.method === 'GET') {
        const readiness = auth.availability(); let session = null;
        if (token) try { session = await auth.publicSession(token); } catch (error) { if (!expired(error)) throw error; }
        send(200, { reachable: true, signInAvailable: readiness.available, reason: readiness.code, signedIn: !!session, session }); return;
      }
      if (url.pathname === '/auth/start' && request.method === 'GET') {
        const redirect = auth.start({ redirectUri: url.searchParams.get('redirect_uri'), state: url.searchParams.get('state'), codeChallenge: url.searchParams.get('code_challenge') });
        response.writeHead(302, { ...headers, Location: redirect }); response.end(); return;
      }
      if (url.pathname === '/auth/callback' && request.method === 'GET') {
        const redirect = await auth.callback(url.searchParams); response.writeHead(302, { ...headers, Location: redirect }); response.end(); return;
      }
      let body;
      if (request.method === 'POST') {
        if (!String(request.headers['content-type'] || '').startsWith('application/json')) throw new ProtocolError('json_content_type_required');
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) throw new ProtocolError('request_too_large'); chunks.push(chunk); }
        body = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (!body || body.schemaVersion !== 1 || typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.requestId)) throw new ProtocolError('invalid_request');
      }
      if (url.pathname === '/auth/exchange' && request.method === 'POST') { send(200, { requestId: body.requestId, ...await auth.complete(body) }); return; }
      auth.assertReady(); const session = await auth.session(token);
      if (url.pathname === '/v1/models' && request.method === 'GET') { send(200, { accountId: session.account, models: await provider.models(token) }); return; }
      if (url.pathname === '/v1/disconnect' && request.method === 'POST') { send(200, await auth.disconnect(token)); return; }
      if (url.pathname !== '/v1/run' || request.method !== 'POST') { send(404, { error: { code: 'not_found' } }); return; }
      const fields = ['schemaVersion', 'requestId', 'agentId', 'accountId', 'prompt', 'input', 'model', 'thinkingEffort'];
      if (Object.keys(body).some(key => !fields.includes(key))) throw new ProtocolError('invalid_request');
      if (body.accountId !== session.account) throw new ProtocolError('account_changed');
      for (const [key, until] of used) if (until < Date.now()) used.delete(key);
      const key = token + '\0' + body.requestId;
      if (used.has(key)) throw new ProtocolError('request_already_used');
      if (inflight.has(token)) throw new ProtocolError('request_in_progress');
      if (used.size >= 2000) throw new ProtocolError('request_capacity_reached');
      used.set(key, Date.now() + 600000); inflight.add(token);
      try {
        heartbeat = setTimeout(() => { if (!response.destroyed) { response.writeHead(200, { ...headers, 'X-Accel-Buffering': 'no' }); response.write(' '); interval = setInterval(() => { if (!response.destroyed) response.write(' '); }, 10000); } }, 100);
        send(200, { requestId: body.requestId, ...await run({ body, token, provider, signal: controller.signal }) });
      } finally { inflight.delete(token); }
    } catch (error) {
      const code = safeCode(error), status = expired(error) ? 401 : error.status === 403 || code === 'origin_not_allowed' ? 403 : code === 'request_too_large' ? 413
        : ['account_changed', 'request_already_used'].includes(code) ? 409 : code === 'request_in_progress' ? 429
          : code.includes('required') || code.includes('unavailable') || code.includes('not_configured') ? 503 : 400;
      send(status, { error: { code } });
    } finally { clearTimeout(heartbeat); clearInterval(interval); }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = new ProtectedStore({ directory: process.env.CREDENTIAL_DIRECTORY, key: process.env.CREDENTIAL_ENCRYPTION_KEY });
  const auth = new HostedSignIn({ configuration: configuration(), store });
  const server = http.createServer({ requestTimeout: 90000, headersTimeout: 10000 }, createHandler({ auth, provider: new ChatGPTPlanProvider(auth) }));
  server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('hosted-agent-listening'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
}
