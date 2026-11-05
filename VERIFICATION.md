# Verification

Verified November 5, 2026 with Node 24.22.0 and Chrome 156.0.8078.80.

## Passed

- `npm.cmd test`: **111 passed, 0 failed**.
- `npm.cmd run test:hosted`: **13 passed, 0 failed**.
- `npm.cmd run build`: production MV3 extension created at `dist/`.
- `npm.cmd run build:preview`: explicit standalone sample rebuilt successfully.
- JavaScript syntax checks and `git diff --check`.
- `npm.cmd run test:browser`: actual unpacked extension, external module scripts,
  production CSP, isolated installed Chrome, and the shipped direct ChatGPT
  authentication/inference adapter with provider network responses mocked.

The direct adapter reuses the original browser-only feasibility extension's
registration, authorization tab, exact loopback callback, temporary redirect
rule, PKCE, RS256/JWKS verification, refresh, revocation, models, and Responses
contracts. The browser suite exercises these paths with generated test identities;
it does not substitute a mock UI adapter. It also checks canceled sign-in and
retry, callback query cleanup, registration reuse, rule cleanup, and that tokens
never enter extension storage or page content.

The browser suite checks compact sign-in/out and models, safe literal output,
separate prompt/input, unsupported effort omission, identical-name/model account
switches with different efforts, another Go after switching, cancellation,
duplicate Go, edits/stale replies, copying, initial/reload/inference expiry, model
403 retention, one status bar beneath navigation, keyboard tabs, dark appearance,
reduced motion, and 320/390/800/1200px layouts with scrolling. It asserts no runtime
errors or CSP violations and no persistence of drafts, results, or credentials.

Native docking is verified in actual Chrome: toolbar click creates a `SIDE_PANEL`
context with no popup window. Direct CDP interaction checks the native panel's
Go/output, navigation during inference, retained input/output, and persistent
document across tab navigation. A second browser window opens its own panel;
navigation remains scoped to each panel's window and single-tab controls disable.
The full widget/lifecycle suite runs on the same packaged extension page in a
regular tab under its real CSP, because Playwright does not expose Chrome's
native side-panel target as a Page. The native-panel checks use that actual
target through CDP rather than substituting a webpage for the dock.

Navigation uses actual Chrome tabs/windows. Tests exercise first/last wrapping,
single-tab handling, and retained prompt, input, model, effort, output, and pending
inference. Unit tests also cover closed-window handling without retargeting,
serialized rapid navigation, and excluding extension tabs without browsing-history access.

Controller/worker tests retain expiry coverage for all lifecycle phases, account
scope, late authentication/model/inference failures after switching, cancellation
slot release, and ordinary network/403 retention. A regression covers sign-out
overlapping an older status check made with previous credentials, plus sign-out
overlapping another dock observing locally cleared direct credentials. Direct
transport tests cover refresh network/403 retention, 401 expiry and explicit
SESSION_EXPIRED envelopes (including HTTP 200/403 and streamed errors), account scope,
and late status/401 responses after switching or signing out. Dock regressions
cover shared model loads and concurrent sign-in/session checks without canceling
another panel's verified account. Hosted tests
cover protected credentials, PKCE/identity verification, generic prompt/input
forwarding, completed streaming, HTTP/CORS boundaries, identity binding,
deduplication, and slow-response expiry envelopes.

Windows preview tests build from LF, CRLF, and mixed source files, assert no
leftover module imports/exports or external script references, and parse the
generated classic script. Extension build tests verify that production bundles
exclude fixtures, optional hosted code, and test-only host permissions.

Evidence: `artifacts/chrome-results.json`, `artifacts/extension-docked.png`,
`artifacts/extension.png`, and `artifacts/extension-dark.png`. The report explicitly records
`mode: mock_direct_chatgpt`, `liveAuthentication: false`, `providerInference: false`.
The browser suite uses the production manifest and restores the production bundle
after testing; fixture endpoints are never added to it.

## Not verified live

No live ChatGPT sign-in, model/effort entitlement discovery, provider inference,
or remote revocation was attempted in this template. The original feasibility
extension was previously reported working with the user's account; that does
not establish live verification of this new extension installation.

There is no hosted-agent configuration prerequisite in the default extension.
Reload `dist/`, approve updated Chrome permissions if prompted, and sign in in
this template to establish its own issued registration. Live access still
depends on account eligibility and consent for `chatgpt.tokens.use.direct`.
No credentials or issued registration from another installation were copied.
The optional generic hosted adapter remains an unused reference and has not
been deployed; its separate setup requirements do not block the default adapter.
