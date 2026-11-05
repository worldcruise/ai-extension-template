# Application Tracker · AI agent template

A reusable UI baseline for the ChatGPT agent and future AI/API agents. This is a new, separately packaged component: the attached ApplicationTracker_v1.1 source does not contain the newer chatgpt-feasibility-test agent. It has not been patched into or tested against that newer agent.

## Preview

Open **preview.html** directly in a current Chrome or Edge browser. Choose **Preview sign in**, select a sample model and thinking effort, edit the prompt/input, and choose **Go**. The preview is self-contained and makes no network requests. Its account, models, and responses are sample data; it does not authenticate with ChatGPT or perform inference.

Alternatively, run `python -m http.server 8080 --bind 127.0.0.1` in this folder and open `http://127.0.0.1:8080`. The modular `index.html` uses the same preview adapter. No installation or build dependencies are needed.

## Baseline behavior

- Sign-in is at the top left. A verified account name and Sign out replace it after successful sign-in.
- Model and thinking effort are compact selectors in the header. Models and each model's supported efforts come from the adapter; no live model names are hardcoded. Unsupported effort is disabled and omitted from requests.
- One status bar sits immediately under the Agent/Settings tabs. Its left light, background, and message change together for neutral, busy, success, warning, and error states. There are no extra toasts or operational status messages elsewhere.
- Prompt template, test input, and result are separate sections. Go and Ctrl/Cmd+Enter run a test. Cancel stops waiting. Copy result reports success/failure in the shared status bar.
- Editing prompt/input/model/effort clears outdated results and discards any late response. Sign-out clears the result. Each test rechecks the session.
- Settings can make either field editable, fixed/read only, or fixed/hidden. Changes are session-local. Fixed/hidden fields still go to the adapter; hidden does not mean secret.
- The UI adapts to its container, supports light/dark appearance, and supports keyboard tab navigation and reduced motion. It stores no tokens, passwords, candidate data, prompt drafts, or results in browser storage.

## Connect the existing hosted agent

Import the stylesheet and mount the shell with the existing authenticated transport. The following is an integration example, not an implemented service:

```js
import { mountAgent } from './src/agent-shell.mjs';
import { chatgptTemplate } from './examples/agents.mjs';

const ui = mountAgent(document.querySelector('#agent'), {
  definition: chatgptTemplate,
  adapter: {
    getSession: existingAgent.getSession,
    signIn: existingAgent.signIn,
    signOut: existingAgent.signOut,
    getModels: existingAgent.getModels,
    run: existingAgent.run,
  },
});

// On navigation/unmount:
// ui.destroy();
```

Wrap/bind methods if the existing transport uses `this`. Only supply server-verified session data. Replace the preview adapter at the composition root; it must never be used for real connection or inference. Set `definition.preview: false` for a live adapter (the default).

The original current agent source is needed to map its actual request/response and login contracts. This package does not register an OAuth client, assign a callback URL, grant ChatGPT-plan inference access, or change the existing hosted authentication flow. No API endpoints or credential conventions are assumed.

### Adapter contract

All methods return promises. Pass AbortSignal into supported underlying requests. The shell also ignores canceled/stale results when the transport cannot cancel a request.

| Method | Input | Expected result |
| --- | --- | --- |
| `getSession` | `{ signal? }` | `null`, or `{ authenticated: true, user: { id?, name }, expiresAt? }` from the verified backend |
| `signIn` | `{ signal }` | Complete existing provider login; return only when it is complete or canceled. Shell then calls `getSession` to verify success. |
| `signOut` | none | Complete existing sign-out. Shell then verifies the session is gone. |
| `getModels` | `{ signal }` | `[{ id, label?, thinkingEfforts: [], defaultThinkingEffort? }]`. Required only when model selection is enabled. |
| `run` | `{ agentId, prompt, input, model?, thinkingEffort?, signal }` | A string, `{ text: string }`, or `{ data: JSON-serializable value }` |

`expiresAt` is an ISO date string or epoch milliseconds. Invalid/expired values are treated as signed out. A rejected run with `status: 401` or `code: 'SESSION_EXPIRED'` returns the UI to sign-in. Other rejected errors are displayed in the shared status bar; provide a user-safe `message` without secrets or internal traces.

Prompt and input are sent as **separate fields**, without implicit variable substitution or concatenation. Map them onto the existing agent's prompt/input contract in the adapter. Results are rendered as literal text, never interpreted as HTML. Provider markup is not executable.

### Chrome extension integration

Use `src/agent-shell.mjs` and the external stylesheet, loaded by an external module script, in an existing extension page. `index.html` demonstrates this script structure. `preview.html` contains inline code for direct desktop preview and is not the extension entry point. Keep the extension's existing CSP, host permissions, auth storage, and authenticated HTTPS transport. The baseline needs no new extension permissions. It adds no job submission, file save, Studio/backend connection, or candidate mutation.

If the existing extension already owns the top-level tabs/status row, mount this shell as the agent view and move the shared status node below the host's tabs during integration. Use one operational status surface; do not leave a second status row in the host. This merge requires the current extension source.

## Future agents

Reuse `mountAgent`, the controller, and the CSS. Change the agent definition and adapter. See `examples/agents.mjs`:

| Definition | Prompt | Input | Model controls | Result source |
| --- | --- | --- | --- | --- |
| `chatgptTemplate` | Editable | Editable | From account | AI adapter |
| `fixedPromptAgent` | Fixed, visible | Editable job description | From account | AI adapter |
| `fixedInputAgent` | Editable | Fixed, hidden sample profile | From account | AI adapter |
| `apiResultAgent` | Hidden, optional | Editable lookup | Hidden | Authenticated API adapter |

For an API agent, implement the same connection/session methods and return `{ data }` from `run`; omit `getModels` when `modelSelection: false`. API URLs, payload mapping, and credentials belong to that agent's existing transport, rather than the shared UI. For specialized future layouts, start from this shell and preserve its account verification, compact controls, status row, cancellation, and result handling.

## Verify and rebuild

```sh
node --test tests/controller.test.mjs
node scripts/build-preview.mjs
```

The controller tests cover verified/canceled/failed login, session expiry, model capabilities, stale responses, cancellation, sign-out, fixed/hidden fields, validation, and API results. Browser verification instructions/results are in `VERIFICATION.md`.
