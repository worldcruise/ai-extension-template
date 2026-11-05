# AI Chrome Extension Template

A docked Manifest V3 extension with a reusable agent shell: compact ChatGPT
sign-in, account-provided Model and Thinking effort selectors, Previous/Next
browser tab, editable Prompt and Input, Go/Cancel, and safely rendered Output.
One status bar with a light and matching background sits directly beneath the
existing Agent/Settings navigation. Copy and keyboard run are included.

## Build and load

Use Node 24. Runtime code has no third-party dependencies; Playwright is a test dependency.

The extension and toolbar icons are included in `assets/` at 16, 32, 48, and
128 px. Edit `assets/icon.svg` and regenerate them on Windows with
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-icons.ps1`.
Normal extension builds copy the existing icons and do not require this exporter.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:hosted
npm.cmd run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select:

```text
C:\Users\Honey\Documents\dev\AI_Agent_Template\dist
```

Click the extension's toolbar button from the browser window you want to navigate.
It opens the agent in Chrome's native side panel, attached to that browser window.
Chrome owns the dock and resize handle. The panel remains mounted when switching
tabs; no separate popup window is created. Each browser window has its own panel
view, with navigation scoped to that view's own browser window.

Previous/Next wraps at the first/last browser tab. Both buttons are disabled for
a single tab or an unavailable source window. A closed window is never silently
replaced with another browser window. Navigation preserves prompt, input, model,
effort, output, and pending inference while navigating. No page text, forms,
titles, or URLs are captured, and no
`tabs`, `activeTab`, scripting, or native-messaging permission is requested.

## Connect ChatGPT — reused feasibility flow

Reload the extension after updating, approve its updated permissions if Chrome
asks, and choose **Sign in with ChatGPT**. Finish sign-in and plan consent in the
authorization tab, then return to the dock. **No hosted-agent URL, server, Python
process, or API key is required by this default adapter.** Settings only contains
Reload models.

`src/direct-oauth.mjs` reuses the browser-only authentication adapter from the
ChatGPT feasibility check: fresh state, nonce and PKCE; the issued client ID;
RS256 signature/JWKS/issuer/audience/expiry/account checks; and explicit
`chatgpt.tokens.use.direct` permission. The exact loopback callback remains
`http://127.0.0.1:1455/auth/callback`. Its temporary Chrome redirect rule applies
only to that sign-in tab and sends the callback into packaged `auth-callback.html`.
The rule is removed after completion, cancellation, timeout, or worker restart.
The callback page clears its one-use code from browser history. This preserves
the feasibility extension's callback handling; it is not a new provider endpoint.

`src/direct-client.mjs` loads the signed-in account's visible catalog from the
existing `/v1/models` endpoint and sends prompt/input to `/v1/responses` with
`store:false` and `stream:true`. It keeps the completed-stream and refusal checks,
including the feasibility fix that uses streamed deltas when final output is empty.
It adds no candidate context or job-output schema to the generic template.

This installation generates and retains its own non-secret host ID and issued
client/verified-subject mapping under `chatgpt-agent.registration`. It does not
copy another extension's credentials or the Python probe's registration. Sign
in again in this template; the existing ChatGPT browser session may make that quick.
Returning sign-in reuses this template's own issued registration and checks the
selected identity before accepting credentials. Access/refresh tokens, account
labels, prompt, input, output, and model preferences remain in worker/page memory.
No provider credential is written to extension storage or included in diagnostics.

The dock gets its own browser window ID from Chrome. Restarting the worker or
browser may require sign-in again. Sign out attempts revocation and clears local
credentials. Live account eligibility and plan consent are still required, but
there is no hosted deployment prerequisite. The optional `hosted-agent/` reference
and hosted transport remain available for future custom adapters; they are not
used by the default extension.

Official references: [registration/sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[model discovery/inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

## Lifecycle and reuse

Go and Ctrl/Cmd+Enter send prompt and input as separate fields through the adapter.
Duplicate Go is disabled while running. Cancel stops waiting; late replies/errors
cannot replace current state. Editing a field or changing model/effort invalidates
old output and pending inference. Ordinary browser-tab navigation does not.

401 and SESSION_EXPIRED during session checks, initial discovery, model reload,
inference, or sign-out clear identity, models, effort, output, and busy state.
Ordinary network failures and model-access 403s retain the verified account.
Account switching compares stable backend account IDs, never display names.
It discards old capabilities even when model IDs match, loads the new account's
efforts, and requires another Go. Requests are constructed only after verification.
Unsupported effort is disabled and omitted; values are never inferred from model names.

The small extension-owned modules are:

- `src/agent-shell.mjs` and CSS: reusable UI, one status surface, safe text rendering.
- `src/controller.mjs`: session, capability, cancellation, and stale-response lifecycle.
- `src/agent-definition.mjs`: default prompt, input/output labels, and field modes.
- `src/extension.mjs`: composition root; replace its adapter for another AI or authenticated API.
- `src/extension-adapter.mjs`, `direct-oauth.mjs`, `direct-client.mjs`, `response-stream.mjs`: the reused direct sign-in, account catalog, and inference transport.
- `src/hosted-runtime.mjs`: shared account-scoped worker lifecycle, used with the direct client by default.
- `src/browser-tabs.mjs`, `side-panel.mjs`, `service-worker.mjs`: docked launch, per-window navigation, and MV3 messages.

Each prompt/input field supports `{value, label, editable, visible, required}`.
Fixed fields use `editable:false`; hidden fields also use `visible:false`.
They retain their values in requests. Definitions can supply `result.label`,
`result.placeholder`, and an optional trusted `result.render(root, output)` DOM
renderer. Provider/user content is always literal text in the default renderer.
Use `modelSelection:false` for an authenticated API adapter with hidden model controls.
No shell rewrite or UI framework is needed.

| Adapter method | Contract |
| --- | --- |
| `getSession({signal?})` | `null` or `{authenticated:true,user:{id,name},expiresAt?}` from the verified backend; `id` is stable |
| `signIn({signal})` | Complete the existing login; the controller rechecks the session |
| `signOut({signal})` | Complete sign-out; failures preserve identity unless expired |
| `getModels({signal,accountId})` | `[{id,label?,thinkingEfforts:[],defaultThinkingEffort?}]`; omitted for API agents |
| `run({agentId,prompt,input,accountId,model?,thinkingEffort?,signal})` | A string, `{text}`, or `{data}` with JSON-serializable data |

## Verification and explicit preview fixtures

```powershell
npm.cmd run test:browser
npm.cmd run build:preview
```

The browser suite loads the actual unpacked extension in isolated installed
Chrome, with its MV3 CSP and external modules. Only provider network responses are
mocked: the shipped sign-in tab, callback redirect rule/page, PKCE code exchange,
RSA identity verification, direct models/Responses requests, and dock run for real
inside the test profile. It does not use a signed-in user profile or call OpenAI.
Results and screenshots are in ignored `artifacts/`;
[VERIFICATION.md](VERIFICATION.md) records the checked behavior and remaining live gate.

Native docking uses Chrome's [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).
The manifest declares `sidePanel` permission and `side_panel.default_path`.
Toolbar opening runs directly in its user gesture; no extra window is opened.

`preview.html` is an optional generated, self-contained sample fixture, using
`examples/preview-adapter.mjs`. Its sign-in, models, and results are mock data,
and browser-tab buttons are disabled. It makes no network requests. The Windows
build regressions cover LF, CRLF, and mixed source files and parse the generated
classic script. Preview code, samples, tests, and the hosted service are excluded
from `dist/`; `index.html` always uses the real extension adapter.
