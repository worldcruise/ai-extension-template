# AI Agent Template

A Chrome Manifest V3 extension with a combined **ChatGPT + Resume Studio** workspace.
Current version: **0.5.0**. See [CHANGELOG.md](CHANGELOG.md) for the checkpoint details.
The Chat view embeds ChatGPT using your browser's session. Resume Studio is based
on `baseline/combined-chatgpt-resume-studio-code` and now has a persistent generation queue.

Studio includes JSON candidate-profile import, job-description extraction,
template/prompt previews, request details, resume previews, and JSON copy.
Profiles, immutable queued inputs, captured replies, results, and company chat
links are saved locally in IndexedDB. Sending is manual for now. Add a job, choose
**Copy prompt** on its request card or in **Details**, then paste and send the full
prompt in ChatGPT yourself. Copying includes the saved candidate profile, instructions,
job description, and output schema; it does not insert text, create an attempt,
mark a request sent, collect a response, or change queue status. If clipboard access
fails, Details opens with the readonly full prompt selected for manual copying.

Automatic Start/Continue/regeneration controls are paused in this build, with a
runner guard behind the UI. Existing automation and recovery code is retained for
later use. Saved results, Details, Review, preview, save retry, and cancellation
remain available. PDF/DOCX export remains unavailable.

ChatGPT stays mounted when switching views, preserving its conversation and composer.
The header holds Resume Studio, Chat, and account controls. New chat, reload, and
open-in-tab actions sit in a toolbar hidden by default. Hover over the top edge
of Chat to slide it down; moving away hides it again. New chat (+) and reload sit
on the left; text-size, open-in-tab, and pin controls sit on the right. Pin the toolbar
to keep it open in its own row above ChatGPT across chat reloads and view switches.
The iframe uses the remaining height, keeping its top content fully visible. This preference is saved
on this device; unpin to restore hover behavior. A small downward chevron
marks the hidden controls. Keyboard focus or a tap on the top edge also reveals
them. The compact search field between the controls expands when focused and shows the
selected candidate's saved company conversations. Type a company or job title to
filter; use Arrow keys and Enter to select, or Escape to collapse. Selecting a
company opens its connected chat. To connect one, open its conversation in Chat,
then use Details → Connect current chat on the saved company in Studio. Links
are saved with their requests locally. Generated results connect their source
conversation automatically.

Stacked Up/Down controls immediately to the right of search browse ChatGPT's own
loaded conversation history in its displayed order. Down from a new chat opens the
most recent conversation; Up stops at the most recent conversation and is disabled
on a new chat. The oldest loaded conversation disables Down. Navigation pauses
while a draft or generation is active. Reading history restores the native sidebar's
previous visibility and keeps the company search scoped to saved companies.

Chat uses the full remaining panel height, with no Studio footer. Studio queue actions stay fixed
below the scrolling content. Model and thinking settings are managed inside
ChatGPT. Account controls open the real ChatGPT sign-in page; the Studio examples
do not represent a connected account.

Chat zoom icons on the right change the font size inside Chat from
50% to 150% in 10% steps, preserving the iframe dimensions and viewport. New
messages and the composer follow the selected text size. Resume template selection
uses all eight original images from `baseline/thumbnails`, bundled locally in
`assets/resume-templates`.
Turning tailoring off keeps the job extraction fields and controls open, hides
the prompt-template dropdown, and uses base-resume instructions. Turning it back
on restores the prompt selection. The description field is labeled Job Description.
Resume options & instructions starts collapsed; click its heading to expand it.

Keyword highlighting applies only to job web pages. Use the Highlight switch
beside the compact tab controls; Read page sits at the far right. Open the user
menu → Settings → Keyword highlights to save keywords (one per line), color,
case matching, and whole-word matching. Select Yellow, Green, Blue, Red, Purple,
Orange, or Custom to edit a separate keyword list for that color. Switching colors
keeps unsaved edits; **Save keywords** saves every list together (up to 200 keywords
per color). The first color shown wins when the same keyword is in multiple lists;
longer phrases at the same position take priority. Existing single-color settings
keep their keywords in the matching group, with the previous Pink preset moving to
Red and other custom colors preserved in Custom. These preferences stay on this device.
Read page can request optional website access; the extension icon and shortcut
also support Chrome's temporary access to the selected job page.
Highlights use CSS text ranges, preserving page markup and editable fields,
and update as job content changes. The dock and ChatGPT are never highlighted.

Previous/Next switches the actual open tabs in the sidebar's associated browser
window, wrapping at either end. The counter updates when tabs open, close, move,
or become active. Company, job title, URL, and JD drafts are retained per tab while
the panel is open. URLs fill from permitted page metadata; manually entered URLs
are retained and included in queued request snapshots. Navigation uses tab IDs and
positions. Read page fills Company, Job title, URL, and Job Description from the
selected tab, including with tailoring off. On first use, its button requests
optional HTTP/HTTPS website access through Chrome. Once approved, it continues
the same read and works across job sites without another extension-icon click.
Declining keeps the fields unchanged. Navigation while consent is pending cancels
that read. Press
**Ctrl+Shift+F** (**Command+Shift+F** on macOS) for the same action from the job
page; it opens the sidebar and selects Studio's Review Job view automatically.
The shortcut uses temporary active-tab access without requesting persistent website
permission. Reading progress stays in the button; results fill the editable fields
and actual errors open a dialog. There is no inline Read page status row.
Open **User menu → Settings → Keyboard shortcuts** to see the current assignment
and choose **Change shortcut** to customize it in Chrome. Existing Chrome assignments
can keep the previous shortcut; Settings and the Read page tooltip show the actual binding.

The **Job Queues** tab contains queued jobs and saved results. While Resume Studio
or the embedded ChatGPT has focus, these sidebar shortcuts are available:

| Shortcut | Action |
| --- | --- |
| Ctrl+Up | Open Resume Studio |
| Ctrl+Down | Open Chat |
| Ctrl+Left | Previous browser tab (the `<` action) |
| Ctrl+Right | Next browser tab (the `>` action) |
| Ctrl+Enter | Add the prepared job to Job Queues |

Settings → Keyboard shortcuts lists these bindings. Ctrl+Enter uses the same job
validation and Add action as the button, preserves the ChatGPT draft, and adds one
request per key press. Dialogs keep their own keyboard controls. These bindings
apply inside the sidebar; Read page remains Chrome’s browser shortcut.

Page extraction combines JobPosting metadata, ATS/board selectors, embedded job JSON, and generic
content-region ranking. Fields stay editable, and edits made during a read are
preserved. See the [repository review and extraction notes](docs/job-extraction-review.md)
for source pins, coverage, validation, and limits.

For generation, open **Profile → Download example format**, fill the JSON with
your own facts, and use **Import profile JSON**. Add jobs and use **Copy prompt**.
The automation behavior described below is retained but paused while manual mode is enabled.
Pause finishes the current response before stopping. Closing the sidebar preserves
the queue and marks unresolved deliveries for reconciliation. Continue sending or
Reconcile delivery handles one request only: it verifies the original prepared
draft or reads the existing marked conversation. It never invents a new attempt
or silently starts other jobs. Add remains available during collection.

Completed invalid JSON and confirmed completed error responses are archived under
**Completed failures** with raw captures and delivery history. They are not resent
automatically. Timeouts, lost connections, and unacknowledged clicks remain
uncertain and block more generation until reconciled. **Generate again** opens a
deliberate regeneration dialog, preserves previous attempts, and queues a new
attempt only after confirmation; sending still requires Start queue. **Retry save**
only persists captured output. Review on a completed valid result opens its recorded
conversation; Details is separate. A missing conversation reference never opens
an unrelated chat. See [queue implementation notes](docs/chatgpt-queue.md).

For the normal-tab workflow inspired by Multi-AI-Prompt, open **Settings → ChatGPT
queue** and choose **ChatGPT tab**. Automated sending remains paused for now.
The extension creates its own ChatGPT tab in this window and activates it to send;
your personal ChatGPT tabs are preserved. Keep the sidebar open while it runs.
**Sidebar Chat** remains available and is the default. The selected connection is
saved locally and locked while a job runs; recovery uses the original connection.
See the [reference review](baseline/multi-ai-prompt/README.md).

If Chat works but the queue cannot recognize the signed-in account, open the user
menu → **Check connection**. The check recognizes account controls, saved-chat
links, and loaded conversations. For an unrecognized layout, **Use this signed-in
session** confirms the current panel session after you check your account in Chat.
Explicit sign-in prompts still block sending. A successful check restores jobs
that were blocked before any send, ready for an explicit Start queue.
The check runs inside this extension; no desktop app or browser-control extension
is required. Install this extension and sign in separately in each browser profile
where you use it; no other extension files or login data belong in the project.

Highlight feedback appears in the toggle's hover hint. The fixed footer uses a
compact queue row with icon controls; action messages remain available to screen
readers and as a queue-row hover hint without taking up a separate status row.

## Start

Requires Node.js 24+ to run the checks and build. There are no package dependencies.

```powershell
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this project's `dist/extension` folder.
3. Pin **AI Agent Template**, then click its icon. The shortcut is **Alt+Shift+G**
   on Windows/Linux or **Command+Shift+G** on macOS; customize it at
   `chrome://extensions/shortcuts`.
4. If needed, sign in to ChatGPT in a normal tab, return to the sidebar, and reload.

The toolbar starts a new chat, reloads the current chat, or opens it in a normal
tab. ChatGPT provides its own conversation history, model picker and composer.
Queued generation submits prompts through the visible ChatGPT interface using
your browser session. It stores the job inputs, captured result, and conversation
link locally; the conversation itself is managed by ChatGPT.

Run `npm run build` and reload the extension after changing its source. You can
also load the repository root directly during development.

## Project map

| Path | Purpose |
| --- | --- |
| `manifest.json` | Extension permissions, entry points and shortcut |
| `index.html`, `src/sidebar.css`, `src/workspace.mjs` | Combined shell, themes, accessible tabs, and dialogs |
| `src/sidebar.mjs` | Live ChatGPT frame loading/recovery and toolbar controls |
| `src/chat-toolbar.mjs` | Hover toolbar and connected company-chat dropdown |
| `src/company-chats.mjs` | Saved company source links scoped to the selected candidate |
| `src/resume-data.mjs` | Candidate format, prompt construction, and strict result/fact validation |
| `src/manual-prompt.mjs`, `src/queue-mode.mjs` | Clipboard-only full prompts and temporary manual sending policy |
| `src/queue-store.mjs`, `src/resume-queue.mjs` | Transactional local queue, shared runner lock, capture recovery, terminal outcomes, and explicit regeneration |
| `src/chatgpt-queue.js` | Isolated ChatGPT composer submission and matching response collection |
| `src/chatgpt-tab-connection.mjs`, `src/chatgpt-tab.js` | Dedicated ChatGPT tab, content-script messaging, and reconnectable result collection |
| `src/queue-connection-settings.mjs` | Saved Sidebar Chat / ChatGPT tab selection |
| `src/browser-tabs.mjs` | Window-scoped open-tab navigation and live tab counts |
| `src/job-page-evidence.mjs`, `src/job-site-adapters.mjs` | Read-only page evidence and ATS/board selector configurations |
| `src/job-extraction-core.mjs`, `src/job-extraction-service.mjs` | Posting selection, normalization, and background read coordination |
| `src/keyword-settings.mjs`, `src/keyword-matcher.js` | Local keyword preferences and literal matching |
| `src/page-highlights.mjs`, `src/job-page-highlighter.js` | Opt-in job-page highlighting with temporary page access |
| `src/studio.mjs`, `src/studio-examples.mjs` | Studio interactions and explicitly labeled example data |
| `src/icons.mjs` | Locally bundled SVG icons; no remote script dependencies |
| `src/service-worker.mjs` | Side-panel setup and frame rule registration |
| `src/sidebar-protocol.mjs` | Frame message checks, conversation URLs and embed rule |
| `src/chatgpt-frame.js` | Readiness/navigation signals and sign-in link handoff |
| `scripts/build-extension.mjs` | Packages only runtime files into `dist/extension` |
| `baseline/` | Original reference extensions; excluded from the build |

The frame integration is adapted from the reference sidebar's architecture. Its
header rule removes `X-Frame-Options` and `Content-Security-Policy` for ChatGPT
subframe requests initiated by **this extension only**. Ordinary tabs and frames
on other websites do not match. Keyword preferences use local extension storage.
Job reading and highlighting use scripting on the selected job page. Read page
requests optional HTTP/HTTPS website access only when clicked; Chrome's permission
dialog controls approval. The extension icon and shortcut can instead use
[temporary active-tab access](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).
No backend service, API key, or OAuth setup is required.

Embedding depends on the ChatGPT website and its current browser/session behavior.
The frame stays visible during slow loading; **Open ChatGPT** and **Try again**
provide recovery without treating a timeout as proof of logout.

## Check

```powershell
npm test
npm run test:browser
```

The browser smoke test checks the combined workspace, candidate isolation, request
snapshots, preview/copy actions, keyboard navigation, narrow layouts, themes, and
preservation of the ChatGPT frame and composer across view changes. It also verifies
the native side panel, connection recovery, JSON profile import, explicit bulk
submission, draft preservation, contenteditable editing, terminal failures, durable
company links, and recovery after closing a running sidebar without duplicate
submission. The tab connection checks also cover a dedicated normal tab, early
chat registration, personal-tab isolation, protected worker drafts, saved connection
selection, and recovery using the same tab and delivery. It uses an isolated Chrome profile and local fixture pages,
not your real ChatGPT account. Set `CHROME_PATH` if Chrome is not at a standard
installation path. Screenshots and the smoke-test report go to `artifacts/`.

Runtime fingerprints are visible in **Settings > ChatGPT queue > Runtime diagnostics**
and the connection dialog. The normal build writes a content fingerprint into
`dist/extension/src/build-info.js`; other bundled runtime files are copied unchanged.
A source checkout reports `source-unbuilt` and cannot authorize generation until
built. Host and adapter fingerprints must match. This identifies reporting runtime
revisions; source/build parity alone cannot identify Chrome's loaded revision.

Company/title snapshots carry provenance for user input, structured data, page
extraction, profile fallback, or missing values. Historical records without evidence
retain their labels and show an unknown historical source. No origin is inferred
from a filename, a label such as ja_mageia, or generated resume fields.
