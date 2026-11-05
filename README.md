# AI Chrome Extension Template

A minimal Manifest V3 extension that opens in Chrome's native side panel.
It includes direct ChatGPT sign-in, account-provided Model and Thinking effort
selectors, Previous/Next browser tab, editable Prompt and Input, Go/Cancel,
safe Output with Copy, and one shared status bar beneath the navigation.

## Build and load

Use Node 24. There are no runtime dependencies; Playwright is for browser tests.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
```

Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**,
and choose this repository's **`dist` folder**. In the current checkout that is:

```text
C:\Users\Honey\Documents\dev\AI_Agent_Template\dist
```

Only `dist/` is needed to run the extension. Keep the source folders to customize
and rebuild it. Reload the extension after rebuilding.

Click its toolbar icon to open the dock in that browser window. Previous/Next
wraps at the first/last tab, disables for one tab, and preserves the prompt,
input, selections, output, and pending inference. Each window has its own panel;
closing a window never redirects navigation to another one. No page content is
captured, and no native messaging or application workflow is included.

## Sign in

Choose **Sign in with ChatGPT** and complete authorization and plan consent in
the sign-in tab. No hosted-agent URL, backend server, API key, or Python process
is required. Settings contains Reload models.

The direct adapter reuses the feasibility extension's state/nonce/PKCE,
issued registration, RS256/JWKS identity verification, refresh, and revocation.
The exact callback is `http://127.0.0.1:1455/auth/callback`; a temporary Chrome
redirect rule, limited to the sign-in tab, sends it to packaged
`auth-callback.html`. No local HTTP listener is needed. Rules are removed after
completion, cancellation, timeout, and worker restart. The callback clears the
one-use code from history.

Each installation stores only its non-secret host ID and issued client/verified
subject mapping. Tokens remain in worker memory; prompts, input, output, and
model preferences remain in page memory. Restarting the worker/browser may
require signing in again. No credentials are copied from another app.
Live access requires account eligibility and `chatgpt.tokens.use.direct` consent.

The adapter fetches visible models and supported effort values from the account,
then sends separate prompt/input to `/v1/responses` with `store:false` and
`stream:true`. Unsupported effort is disabled and omitted. Requests are built
after verifying identity and capabilities. Account scope uses verified stable
identity, never a display name. Expiry clears identity, selections, output, and
busy state; ordinary network failures/model-access 403s preserve the account.
Cancel, editing, account/model changes, and sign-out invalidate stale work.

Official contracts: [sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

## Use for another app

| Change | File |
| --- | --- |
| Extension name, description, version, permissions | `manifest.json` |
| Prompt, input, labels, output renderer | `src/agent-definition.mjs` |
| Page title | `index.html` |
| Initial authorization app-name hint | `src/direct-oauth.mjs` |
| UI composition or replacement API adapter | `src/extension.mjs`, `src/extension-adapter.mjs` |
| Worker transport | `src/direct-client.mjs`, `src/service-worker.mjs` |
| Icon | `assets/icon.svg` and PNG exports |

Keep `agent-shell.mjs`/CSS, `controller.mjs`, and `agent-runtime.mjs` as the shared
UI/lifecycle shell. `browser-tabs.mjs` and `side-panel.mjs` own dock navigation.
Prompt/input fields support `{value, label, editable, visible, required}`. Fixed
fields use `editable:false`; hidden fields also use `visible:false`. Hidden
fixed values still enter requests. Use `modelSelection:false` for an authenticated
API agent without AI models. The default output renderer uses literal text;
an optional trusted `result.render(root, output)` can render agent-specific DOM.

Adapters implement `getSession`, `signIn`, `signOut`, `getModels` (AI only), and
`run`. Sessions return `{authenticated:true,user:{id,name},expiresAt?}`; `id`
must be stable and verified. Models return `{id,label?,thinkingEfforts:[],
defaultThinkingEffort?}`. `run` receives `{agentId,prompt,input,accountId,model?,
thinkingEffort?,signal}` and returns a string, `{text}`, or `{data}`. Preserve
abort signals and account checks when replacing a transport. Any new network
origin also needs explicit manifest host permissions and CSP configuration.

PNG icons at 16/32/48/128 px are already included. On Windows regenerate them with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-icons.ps1
```

## Verification

`npm.cmd test` checks account/session lifecycle, cancellation, stale responses,
same-name/model account switches, direct authentication/transport, navigation,
icons, and extension builds from LF, CRLF, and mixed source files. Production
pages use external modules under MV3 CSP; there is no standalone preview bundle.

`npm.cmd run test:browser` uses isolated installed Chrome and the actual unpacked
extension, including its native dock, real callback/PKCE/RS256 code, and CSP.
Only provider network responses are mocked. It checks sign-in/out, model loading,
expiry, account switching, Go/Cancel, Copy, tab navigation, one status bar, and
320/390/800/1200 px layouts. Reports/screenshots are generated under ignored
`artifacts/`; they are disposable. `node_modules/` can be recreated with `npm.cmd ci`.

These automated checks do **not** establish live ChatGPT sign-in, entitlement,
inference, or revocation. Sign in and run Go with your own account to verify live
access. No hosted server configuration is required by the direct adapter.
