# Optional generic hosted adapter

The default extension uses the direct feasibility sign-in adapter and does not
use this service or require a hosted-agent URL. This is an alternative reference
for a future custom adapter; its deployment requirements apply only to that path.

This dependency-free Node 24 service reuses the existing verified ChatGPT sign-in,
encrypted credential storage, account model discovery, and completed-stream
provider adapter. The only inference handler is generic: prompt becomes
instructions, input remains plain user text, and the returned text is passed to
the extension without a domain-specific JSON schema or additional context.

Run offline tests with `npm.cmd run test:hosted` from the repository root.
The deployed entry point is `node hosted-agent/src/server.mjs`; deploy the
repository's `hosted-agent/src` plus its shared `src/protocol.mjs` module. The
extension build does not include or launch this server.

Supply the names in `.env.example` through the hosting platform. Required values
are an authorized HTTPS `PUBLIC_BASE_URL`, the exact approved
`SIWC_REDIRECT_URI=https://<your-origin>/auth/callback`, issued `SIWC_CLIENT_ID`,
its registered token-auth method and secret when needed, stable `SIWC_HOST_ID`,
and installed `ALLOWED_EXTENSION_IDS`. Keep `CREDENTIAL_DIRECTORY` on a private
persistent volume and the 32-byte base64 `CREDENTIAL_ENCRYPTION_KEY` separately in
the platform secret manager. Use one replica for process-local pending logins,
one-use codes, deduplication, and refresh serialization.

The trusted ingress must replace `X-Forwarded-Proto` with `https`, keep the HTTP
port private, disable request/query/body and Authorization logging, and disable
response buffering. Slow requests flush JSON whitespace before their one final
result; clients must inspect its error envelope even after HTTP 200.

`SIWC_PLAN_USAGE_APPROVED=true` is only an operator assertion of an existing
approved hosted ChatGPT-plan registration. Setting it does not grant access.
Identity-only registration is insufficient. The existing local probe's
registration and credentials are not imported. No API-key billing fallback is
present. See the official [sign-in flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
and [models/inference flow](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

The reused Chrome callback is
`https://<installed-extension-id>.chromiumapp.org/agent`; the provider callback is
the host's separately approved `/auth/callback`. Provider tokens stay protected
on the host. Chrome exchanges a one-use PKCE-bound code for an opaque two-hour
agent session in worker RAM.

| Route | Contract |
| --- | --- |
| `GET /v1/status` | Readiness plus `session:null` or verified `{authenticated:true,user:{id,name},expiresAt}` |
| `GET /auth/start`, `GET /auth/callback`, `POST /auth/exchange` | Existing hosted sign-in/one-use code exchange |
| `GET /v1/models` | `{accountId,models:[{slug,display_name,thinkingEfforts,defaultThinkingEffort?}]}` |
| `POST /v1/run` | `{schemaVersion:1,requestId,agentId?,accountId,prompt,input,model,thinkingEffort?}` → `{schemaVersion:1,requestId,text}` |
| `POST /v1/disconnect` | Existing revocation and local credential clearing |

The stable public account key comes from the existing verified client/subject
mapping, never a display name. Requests bind that key and revalidate model/effort
support before inference. Optional effort metadata is forwarded from the account
catalog's `supported_reasoning_levels[].effort` / `default_reasoning_level` fields;
absent metadata yields a disabled selector. There is no model-name capability table.
Supported effort maps to Responses `reasoning.effort`. No inference retries occur.

Deploy the generic `/v1/run` implementation with this extension or replace the
adapter at the composition root. The service is implemented and tested with
fixtures; live hosting, registration, entitlements, and inference remain unverified.
