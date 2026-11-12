# AI Agent Template

A Chrome Manifest V3 extension with a docked job form, application queue, and
expandable ChatGPT / DeepSeek chat. Current version: **0.15.2**.

Save jobs locally, then choose **Generate documents** to submit a prompt and
collect and validate the reply. With Auto download on, the documents are saved
to the job and downloaded automatically. ChatGPT and DeepSeek reuse an idle open tab or open
one when needed. Generation runs independently of the dock. **Add to queue** only saves
the job; it does not change the clipboard or send anything.

## Install and develop

Use Node.js 24 or newer. The document libraries and fonts are bundled locally;
the extension makes no CDN requests. To rebuild the PDF/Word library bundle,
run `npm ci` followed by `npm run build:documents`. Ordinary extension builds
use the checked-in bundle:

```powershell
npm run build
```

Open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and
choose `dist/extension`. Pin the extension and click its icon to open the dock.
After source changes, rebuild and reload the extension. Close and reopen an
existing dock so it uses the updated scripts.

## Versioning

Use **MAJOR.MINOR.PATCH**; **misc** is an alias for patch, not a fourth number.
The numbering follows [Semantic Versioning](https://semver.org/) with numeric
components compatible with [Chrome's manifest rules](https://developer.chrome.com/docs/extensions/reference/manifest/version).

| Change | Command | Increment |
| --- | --- | --- |
| Breaking compatibility with supported workflows, stored data, or import/export formats | `npm run version:major` | `X.Y.Z` → `(X+1).0.0` |
| Add features while retaining supported behavior and data | `npm run version:minor` | `X.Y.Z` → `X.(Y+1).0` |
| Miscellaneous fixes, UI polish, documentation, or internal maintenance | `npm run version:misc` | `X.Y.Z` → `X.Y.(Z+1)` |

`npm run version:patch` is equivalent to `version:misc`. Before `1.0.0`, minor
versions mark development milestones, including evolving workflows. The current
milestone collects the dock, DeepSeek support, and per-job document generation;
it does not imply live-provider compatibility has been verified.

Write the pending changes under **Unreleased** in `CHANGELOG.md`, then run one
version command for the highest-impact change in that release. It uses
`package.json` as the source of truth, updates the manifest, both lockfile
versions and this README, dates the changelog section in UTC, and rebuilds
`dist/extension`. Major increments reset minor and patch; minor increments reset
patch. Existing release entries remain unchanged. No commit, tag, or publication
is performed. If the build fails, fix the error and run `npm run build` again;
the version has already been updated.

Use `npm run version:check` to check consistency. Builds reject mismatched
versions; ordinary builds and local edits do not increment them. Source build
metadata reads the manifest version, while each build records that version and
a content fingerprint. These release numbers are separate from stored-data
schema versions and the upstream `tech-int-chat` adapter version.

## Workspace

Click the bottom status bar to expand chat. Click it again to return to the job
workspace. Apply to jobs is the first and default tab; Queue shares the compact top header, and the + tab opens
the job form. Expanding the job workspace collapses chat. The user icon opens provider selection,
candidate profiles, sign-in, and settings.

The workspace uses ApplicationTracker_v2.1's indigo palette. The theme button in
the user menu switches light and dark themes and remembers the choice across
docks. Clicking a queue card heading expands its document, chat and maintenance
actions. Clicking it again or expanding another card collapses it. **View detail**
opens the job description in a popup. Apply to jobs selects prepared jobs from
the current candidate's full queue. Changing the selected job silently switches
the sidebar to its saved AI conversation while keeping chat collapsed and the
current browser tab focused. Drafts and active responses remain protected.
Each document has Edit, Preview and Download icons. Resume, cover-letter and job
description previews open in popups. The bottom Autofill bar is a disabled placeholder.

Both provider frames stay mounted when switching views, preserving conversation
and composer state. Collapsed chat keeps its viewport off-screen, with input and
focus disabled until expansion. The frames use your existing browser sessions.

Both chats have a toolbar with New chat, Reload, native chat search, Up/Down
history navigation, text size, Open in tab, and a saved pin preference. Hover or
focus the top edge to reveal it; pin it to keep it visible. History navigation
uses native conversation links, skips pinned chats, and starts at the newest
regular chat. Search forwards your query to the provider's own search UI.
Drafts and active responses block navigation that would discard them.

Choose ChatGPT or DeepSeek from the selector in the bottom AI bar, under
**Settings → Chat settings**, or in the user menu. The selectors stay synchronized.
**Open selected AI** focuses the first idle tab for that provider or opens its
home page if none is available. This selection also determines the provider for new document-generation
runs. Existing runs stay with their original provider and conversation.

DeepSeek remembers the cookie-banner choice you explicitly make. After an
offline/online transition, it probes the embedded page and can retry a stuck
load once. Recovery preserves healthy pages, drafts, unfinished sign-in input,
active responses, and the current conversation. Reload and Reconnect remain
available when the message box has not loaded.

## Local jobs and documents

Import a candidate JSON file from **User menu → Candidate profile**. The example
download shows the supported fields. Profiles, job snapshots, documents, and
connected chat URLs stay in IndexedDB on this device. Generation records retain
their job/profile snapshot, prompt, progress, conversation link, and captured
reply locally. Clicking Generate documents sends that snapshot to the selected
provider through its website using your signed-in session.

**Read page** extracts a job's company, title, URL, and description from the
selected browser tab. Review or edit those fields, select the desired template
preferences, and choose **Add to queue**. Writing preferences are included when
you subsequently generate documents; the resume template controls preview style.

**Add This Job in One Click** appears for HTTP/HTTPS pages absent from the
selected candidate's list, excluding AI chat sites and webmail pages. By default
it reads the selected listing and saves the extraction directly, without AI
analysis or salary estimates. **Settings → Chat settings → Job capture → Let AI
analyze the job** is off by default and enables the following cleanup flow.

When enabled, capture sends the listing evidence to the selected ChatGPT or DeepSeek
web tab for cleanup. The candidate's professional history and skills provide
context for missing salary estimates; contact details are omitted from that prompt.
The final card appears only after the returned JSON passes schema, capture-ID,
Apply-URL and salary-attribution checks. The action remains available when chat is expanded.
Website access may require Chrome's permission
dialog. Extension shortcuts can use temporary active-tab access.

The optional AI JSON contains the employer, exact advertised title, cleaned description,
observed Apply URL, and salary with `listed` or `estimated` attribution. Listed
pay must quote the supplied evidence exactly. Missing pay is an **AI estimate**
based on the job and candidate; its assumptions are available in Details. It is
not employer-provided pay or verified current market compensation.

HiringCafe captures use the external employer/ATS Apply href with either setting. If a single Apply
control hides its destination behind JavaScript, the extension clicks that control
and observes its own tab or opened child tab. Ambiguous or missing destinations
require manual entry; AI cannot invent a URL or save HiringCafe as the Apply URL.
Pending captures stay outside the card list with Open AI tab, Resume, Enter
manually, and Cancel actions. Their progress survives closing the dock. The saved
cleanup conversation is reused when generating that job's documents.

If one-click capture fails, **Add job manually** opens with the source URL
(or the observed employer Apply URL for HiringCafe),
any extracted fields, and the reason for the failure. Enter or correct the
company, title, optional salary, and description, then choose **Add to queue**.
The form keeps the original candidate and retains your entries if saving fails.

**Check existing company or URL** is enabled by default. It checks the selected
candidate's saved jobs before adding a duplicate. Company matching ignores case
and extra spaces; URLs ignore tracking parameters while retaining job IDs and
hash routes. Examples, cancelled jobs, and base resumes are excluded from the
company check. Queue search and status filters do not change stored jobs.

Saved job cards follow Application Tracker 2.1's compact layout: company, role,
salary and status, a primary Apply or Generate action, and **View detail**.
The heading expands Resume, Cover letter, Update, Delete, generation controls
and listing/chat links. Salary values appear without a prefix; their source
and any estimate assumptions remain available in the detail popup.
Delete removes the job from the visible queue using its existing cancellation state.
Details can connect the current ChatGPT or
DeepSeek conversation, which can later be reopened from the job.

**Go to apply** opens or reuses the job listing and focuses it. Its saved AI
conversation is reused or opened in the background, without sending a prompt
or taking focus. A job without a saved AI conversation opens only the listing.
Repeated clicks reuse those tabs.

For both providers, **Generate documents** checks the active provider tab first,
then other open tabs by most recent use. It skips chats that are generating a
reply, tabs already reserved by another run, and pages whose editor is not ready.
DeepSeek also skips protected drafts and attachments. For a new job without a
saved conversation, it reuses the idle tab and loads the provider's home page
before sending if that tab is inside another chat. A tab already on the home
page needs no reload. If no idle tab is available, it opens a new one and waits
for loading/sign-in. Jobs with a saved conversation return to that exact chat;
a new submission waits if that saved conversation is busy.
Only one job at a time can use a given tab. Resume observes an already-submitted
run in its original conversation, including while its response is still generating.
DeepSeek is limited to one active job across all tabs. Finish or Stop tracking
that job before starting another; ChatGPT retains concurrent jobs in separate tabs.

The ChatGPT adapter is based on `tech-int-chat` v2.1.5, retaining editor selection,
readiness checks, cancellation, and bounded diagnostics. It replaces unsent
draft text, inserts the prompt through native text input, verifies it, and
presses Enter once. It never dispatches a paste event, avoiding ChatGPT's
large-paste conversion to a text attachment. Existing attached files must be
removed before submission. Already-posted prompts are observed rather than
sent again. A disabled Send control is never bypassed with Enter.

The matching assistant reply is collected automatically after generation ends.
New tailored-application prompts also request corrected employer and advertised
title, a complete cleaned JD, an observed Apply URL, and listed salary or a
candidate-based estimate. The JSON `job` object contains exactly `company`,
`title`, `applyUrl`, `description`, and `salary`; salary contains `value`, `source`,
`evidence`, and `basis`. The extension validates these fields together with the
documents, then updates the saved card automatically, including with Auto download
off. A changed employer, title or JD marks older saved documents as needing an
update until the new documents are saved. Newer manual edits remain protected.
Existing in-progress runs retain their original output contract.

New prompts request one fenced JSON code panel containing job details and the selected documents and
ask the provider to check JSON/identifiers, candidate facts, and completeness
in three passes. The extension independently validates the result before review.
For new ChatGPT runs, capture reads the response's code block, including the
current CodeMirror panel layout. It waits for streaming to stop, the block to
settle, and the Send control to become ready. A final reply toolbar also signals
completion when an empty composer keeps Send disabled. Thinking blocks, user
prompts, and later turns are excluded. Multiple JSON blocks or invalid output
remain available for review instead of being silently repaired.
ChatGPT replies can be captured while its page has no saved conversation URL.
The result must match the job and run in the extension's bound tab. Draft
previews and editor mirrors do not count as posted user messages. If the provider
does supply a conversation link, it is retained for reopening that chat.
DeepSeek uses its earlier capture path: locate the posted job prompt, read the
first assistant answer before the next user turn, wait for generation to finish,
and validate the job/run IDs and documents. Accessibility live regions and
copy-status feedback do not exclude valid replies. Unrelated sidebar loading
indicators do not block completion. Capture diagnostics remain stored with the run.
Capture reads native highlighted `pre` spans as well as `pre code`, excluding
code-panel labels. It groups sections within the same response and prefers the
dedicated final-answer container over reasoning. Complete matching JSON does not
require hover controls; labelled sibling response controls are also recognized.
Streaming must stop and the output must settle before collection. Unrelated
audio controls and old streaming indicators do not block the bound response.
Composer mirrors and draft previews are excluded from posted-message detection;
an unlabelled run marker still present in the editor cannot skip submission.
**Review documents** opens the captured resume and cover letter in Documents.
With Auto download off, choose Save to apply them to the job. Invalid replies
remain available for correction. **Stop tracking** stops extension monitoring;
it does not stop an already-running response on the provider website.

**Resume** continues a run after sign-in, connection, or page problems. Once a
submission attempt is recorded, recovery only checks the same conversation and
never resends. If the AI tab was closed, Resume opens its saved conversation
in a new tab and continues collecting the reply. Without a saved link, the unique run marker must still be
visible in an open tab; otherwise import the documents manually. If preparation
failed and you sent its prompt yourself in the opened
tab, Resume recognizes that run's posted message and collects the reply without
another submission. ChatGPT monitoring recovers from temporary extension
connection failures and page reloads in the same owned tab without focusing
it or sending again. The workspace checks active ChatGPT runs every ten seconds and
attempts to reattach after 45 seconds without a heartbeat. Reconnecting and
Tracking paused distinguish missing monitoring from provider generation;
frozen or discarded tabs resume tracking when Chrome restores them.
DeepSeek's automatic periodic and tab-activation recovery are disabled. Passive
health checks report Tracking paused after 45 seconds without a heartbeat and
offer Resume, preserving the active job and its submission record. A page reload can
reattach its current run; connection failures require Resume. On upgrade, any
additional active DeepSeek runs are paused with their saved data preserved.
There is one run per job, with no bulk runner or automatic submission retries.
Browser checks use local fixtures; live compatibility depends on each
provider's markup and signed-in session.
See [the DeepSeek capture investigation](docs/deepseek-capture-research.md) for
the reproduced failures, pinned references, fixture limitations, and repair tests.

**Update** opens Documents, which accepts pasted or imported resume JSON and an optional cover
letter. Validation checks the job and fixed candidate facts before marking the
job Ready. Cancelling leaves saved documents unchanged, and stale edits cannot
overwrite newer updates. Resume preview and JSON copy remain available;
saved and generated results also support PDF, Word (.docx), and JSON downloads.
The Apply view downloads each saved document individually using the current
format and preview preferences, including manually updated documents.

Under **Settings → Chat settings → Documents**, **Add cover letter**, **Auto download**,
and its child option **Auto preview** default on. Download formats are checkboxes;
choose one or more of PDF, Word, and JSON. PDF is selected initially. New runs
snapshot these preferences; turning off Add cover letter requests and validates
a resume only. Turning off Auto download retains the other preferences for later.
With Auto download on, validated documents save to the job and mark it Ready
before downloading. The document review form stays closed;
choose **Review documents** when you want to open it. Auto preview controls
downloaded-file preview tabs separately. With Auto download off, generation
continues to open the review form automatically.

After a reply passes validation, selected documents download to the `AI Agent`
folder in Chrome's configured Downloads location, even if the dock is closed.
Each completed download can open a browser preview using the same saved bytes.
Word has a text preview; **Open downloaded file** launches the native file on a
click. Browser settings can still prompt for a download location. Downloads use
a clean one-column layout; template thumbnails currently affect the in-app preview.
Invalid replies never save or download automatically. A newer job edit prevents
automatic saving and downloading; use Review documents to resolve it. Download
errors leave the saved job and captured result intact;
**Download files** retries using the current format and preview preferences.
Retries do not repeat a successful automatic save. With Auto download off,
Review and Save control which generated documents become the approved job records.

Existing jobs, profiles, and documents are preserved. Old in-progress records
without a saved resume appear as Needs attention; old records with saved resumes
appear as Ready. No old runner, delivery, or recovery work resumes.

## Shortcuts and highlights

Ctrl+Up/Down switches between the job workspace and chat. Ctrl+Left/Right moves
between browser tabs. Ctrl+Enter saves the job to the queue. Dialogs retain their
own keyboard controls. The Read page shortcut defaults to Ctrl+Shift+F
(Command+Shift+F on macOS); change it in Chrome's extension shortcut settings.

Keyword highlights are configurable in Settings and apply only to job pages
with granted access. They use literal matching and preserve page markup.

## Project map

| Path | Purpose |
| --- | --- |
| `manifest.json`, `index.html`, `src/sidebar.css` | Extension resources and dock UI |
| `src/workspace.mjs`, `src/workspace-dock.mjs`, `src/studio.mjs` | Workspace navigation, forms, and local job actions |
| `src/job-queue.mjs`, `src/queue-store.mjs` | Local job/profile/document persistence |
| `src/generation-service.mjs`, `src/generation-store.mjs`, `src/generation-client.mjs` | Persistent per-job runs, tab ownership, and UI progress |
| `src/generation-tab.js`, `src/generation-dom.js`, `src/generation-chatgpt.js`, `src/generation-deepseek.js` | Browser-tab input, submission receipt, and reply observation |
| `src/chatgpt-submit-adapter.js`, `src/ai-tabs.mjs`, `src/apply-tabs.mjs` | Native plain-text input and Enter, idle-provider tab selection, and background chat reuse for Go to apply |
| `src/generation-data.mjs` | Prompt envelopes, conversation URLs, and reply validation |
| `src/manual-documents.mjs`, `src/queue-documents.mjs`, `src/resume-data.mjs` | Manual document import, editing, and validation |
| `src/chatgpt-frame.js`, `src/sidebar.mjs`, `src/sidebar-protocol.mjs` | Embedded ChatGPT UI state and manual navigation |
| `src/deepseek-frame.js`, `src/deepseek-toolbar.mjs`, `src/deepseek-recovery.mjs` | Embedded DeepSeek UI and connection recovery |
| `src/chat-providers.mjs`, `src/native-chat-search.js`, `src/sidebar-history.js` | Provider selection, search, and native history |
| `src/job-page-evidence.mjs`, `src/job-site-adapters.mjs`, `src/job-extraction-core.mjs` | Read-only job extraction |
| `src/job-cleanup.mjs`, `src/job-apply-url.mjs` | AI cleanup schema, prompts, validation and observed Apply destinations |
| `src/job-analysis-settings.mjs` | Persisted opt-in for AI job analysis, off by default |
| `src/service-worker.mjs` | Side-panel setup, scoped frame rules, job-page commands, and run messaging |
| `scripts/build-extension.mjs` | Runtime-only build in `dist/extension` |
| `baseline/` | Reference projects, excluded from the extension build |

Embedding rules apply only to provider subframes initiated by this extension.
No backend service, API key, or OAuth configuration is required. Provider
embedding and sign-in still depend on each website's browser/session behavior.

## Checks

```powershell
npm test
node tests/chrome.mjs --workspace-only
npm run test:browser
```

Unit tests cover local storage behavior, preserved legacy data, document
validation, duplicate checks, extraction, provider protocols, and build contents.
Generation tests cover concurrent starts, persisted submission intent, sender
binding, stale tab IDs, and validation failures.
Chrome checks use an isolated profile and local fixture pages to verify dock
layouts, keyboard controls, saved documents, chat navigation, draft preservation,
DeepSeek recovery, and document generation with textarea/rich editors, delayed
readiness, disappearing Send controls, reloads, and dock closure. They do not use
a live account. Set `CHROME_PATH` if Chrome
is not in a standard installation location. Reports and screenshots go to
`artifacts/`.

### Real editor checks

The optional editor suite runs the current ChatGPT adapter against actual
ProseMirror in an isolated Chrome profile, using synthetic prompts on a local
page. Install its test-only packages outside the extension, then run it:

```powershell
npm install --prefix artifacts/chatgpt-retention-research --ignore-scripts --no-package-lock --no-audit --no-fund prosemirror-view@1.42.9 prosemirror-model@1.25.13 prosemirror-state@1.4.4
node tests/chatgpt-editor.mjs
```

It checks long/multiline text, Unicode, layout-dependent text readings, composer
replacement, competing editors, reuse of matching drafts, and rejection of
altered text before submission. It does not contact ChatGPT or use your account.
Results are saved in `artifacts/chatgpt-retention-research/verification-results.json`.

Submission and capture diagnostics are retained internally with each run.
The last check records the extension version,
build fingerprint, comparison counts, first mismatch position/type, editor
replacement count, and Send readiness. Capture diagnostics also record reply
and code-block counts, job/run matching, streaming, and completion signals.
It excludes the prompt, response text, page HTML and
conversation URL. These diagnostics survive closing the dock and are retained
while Resume checks an already-prepared prompt. A matching draft is verified and
submitted without reinsertion; a recorded submission attempt is never resent.
