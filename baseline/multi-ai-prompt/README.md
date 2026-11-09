# Multi-AI-Prompt reference review

Reviewed the [store listing](https://chromewebstore.google.com/detail/multi-ai-prompt/ddebobakhbknpcmiobbpkgbhhccmdmop),
the developer's [privacy policy](https://gist.github.com/codeandquestion/c31f44f68e8735802c0281894a17e4a1),
and Google's distributed package, version 1.6.1, on November 8, 2026.
The immutable package hash and inspected paths are in [reference.json](reference.json).
The package was neither installed nor executed. Its scripts are not included in
the production extension or redistributed in baseline.

## Findings from the package

| Component | Observed behavior | Application in this project |
| --- | --- | --- |
| `manifest.json` | Normal website content scripts; popup/side-panel orchestration. Extension pages prohibit frames. | Offer a normal ChatGPT tab connection alongside the existing embedded Chat. |
| `popup/modules/prompt-sender.js` | Activates the selected AI tab, waits briefly, sends through extension messaging, carries a session ID. | Activate a dedicated queue tab before submission; keep request/delivery UUIDs and durable send authorization. |
| `content-scripts/chatgpt.js` | Configures editor, Send, assistant-response, and generation selectors for a shared adapter. | Reuse our existing page adapter for both transports instead of duplicating submission and validation. |
| `content-scripts/content-script-base.js` | Inserts text, waits for an enabled Send control, clicks it, and checks loading plus stable response text. Includes an Enter fallback and latest-response extraction. | Keep enabled-button waiting and stable result collection, while requiring the exact delivery marker and never falling back to another send after dispatch. |
| `utils/bg-tab-operations.js` | Pings the content script before injection and checks generation state. | Connect to the declared content script, wait for the composer, and stop when the tab closes or navigates. |

These are observed implementation behaviors, not proof that the reference works
with every live account. Its multi-provider comparison, image generation, capture,
and workflow features are outside this resume queue's current scope.

## Resulting workflow

Settings → ChatGPT queue → ChatGPT tab selects the tab connection. Sidebar Chat
remains the default. Starting the queue creates/reuses a dedicated tab in the
sidebar's window and sends one job at a time. Existing personal ChatGPT tabs are
never selected as workers. Each job gets a saved conversation, associated user and
assistant turns, raw output, and validated resume. Sidebar closure retains the
worker tab and recorded delivery for explicit read-only recovery.

No extra browser extension, backend, API key, or broader host permission is added.
Chrome's existing ChatGPT host permission permits tab access and content-script
messaging; see the official [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
and [message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) documentation.
