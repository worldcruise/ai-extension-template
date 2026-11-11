# AI Agent Template

A Chrome Manifest V3 extension with a docked job form, application queue, and
expandable ChatGPT / DeepSeek chat. Current version: **0.6.2**.

Save jobs locally, then choose **Generate documents** to submit a prompt and
collect the reply for review. ChatGPT uses a tab you already opened; DeepSeek
opens a dedicated tab. Generation runs independently of the dock. **Add to queue** only saves
the job; it does not change the clipboard or send anything.

## Install and develop

Use Node.js 24 or newer. There are no package dependencies to install.

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
workspace. Job form and Queue share an accordion header; expanding one workspace
collapses the other. The user icon in the status bar opens provider selection,
candidate profiles, sign-in, and settings.

Both provider frames stay mounted when switching views, preserving conversation
and composer state. Collapsed chat keeps its viewport off-screen, with input and
focus disabled until expansion. The frames use your existing browser sessions.

Both chats have a toolbar with New chat, Reload, native chat search, Up/Down
history navigation, text size, Open in tab, and a saved pin preference. Hover or
focus the top edge to reveal it; pin it to keep it visible. History navigation
uses native conversation links, skips pinned chats, and starts at the newest
regular chat. Search forwards your query to the provider's own search UI.
Drafts and active responses block navigation that would discard them.

Choose ChatGPT or DeepSeek under **Settings → Chat settings** or in the user
menu. **Open selected AI** focuses an existing ChatGPT tab or opens DeepSeek's
home page. This selection also determines the provider for new document-generation
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
selected candidate's list. It reads the page and saves the job, and remains
available when chat is expanded. Website access may require Chrome's permission
dialog. Extension shortcuts can use temporary active-tab access.

**Check existing company or URL** is enabled by default. It checks the selected
candidate's saved jobs before adding a duplicate. Company matching ignores case
and extra spaces; URLs ignore tracking parameters while retaining job IDs and
hash routes. Examples, cancelled jobs, and base resumes are excluded from the
company check. Queue search and status filters do not change stored jobs.

Saved job cards offer Details, Go to apply, Documents, resume preview, and
cancellation where applicable. Details can connect the current ChatGPT or
DeepSeek conversation, which can later be reopened from the job.

For ChatGPT, open and sign in to a normal browser tab first. **Generate documents**
uses the active ChatGPT tab, or the most recently used one if another site is
active. It can append the job prompt to the conversation already open there.
It does not create, reload, or navigate a ChatGPT tab. Only one job at a time
can use a given tab. DeepSeek continues to open a dedicated tab.

The ChatGPT adapter is based on `tech-int-chat` v2.1.5, retaining editor selection,
readiness checks, cancellation, and bounded diagnostics. It replaces unsent
draft text, inserts the prompt through native text input, verifies it, and
presses Enter once. It never dispatches a paste event, avoiding ChatGPT's
large-paste conversion to a text attachment. Existing attached files must be
removed before submission. Already-posted prompts are observed rather than
sent again. A disabled Send control is never bypassed with Enter.

The matching assistant reply is collected automatically after generation ends.
New prompts request one fenced JSON code panel containing both documents and
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
**Review documents** opens the captured resume and cover letter in Documents.
Saving is required before they replace approved job documents. Invalid replies
remain available for correction. **Stop tracking** stops extension monitoring;
it does not stop an already-running response on the provider website.

**Resume** continues a run after sign-in, connection, or page problems. Once a
submission attempt is recorded, recovery only checks the same conversation and
never resends. If the ChatGPT tab was closed, open that conversation yourself
before resuming. Without a saved link, the unique run marker must still be
visible in an open tab; otherwise import the documents manually. If preparation
failed and you sent its prompt yourself in the opened
tab, Resume recognizes that run's posted message and collects the reply without
another submission. There is one run per job, with no bulk runner or automatic
retries. Browser checks use local fixtures; live compatibility depends on each
provider's markup and signed-in session.

**Documents** accepts pasted or imported resume JSON and an optional cover
letter. Validation checks the job and fixed candidate facts before marking the
job Ready. Cancelling leaves saved documents unchanged, and stale edits cannot
overwrite newer updates. Resume preview and JSON copy remain available;
PDF/DOCX export is not implemented.

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
| `src/chatgpt-submit-adapter.js`, `src/chatgpt-tabs.mjs` | Native plain-text input and Enter, plus selection of an already-open ChatGPT tab |
| `src/generation-data.mjs` | Prompt envelopes, conversation URLs, and reply validation |
| `src/manual-documents.mjs`, `src/queue-documents.mjs`, `src/resume-data.mjs` | Manual document import, editing, and validation |
| `src/chatgpt-frame.js`, `src/sidebar.mjs`, `src/sidebar-protocol.mjs` | Embedded ChatGPT UI state and manual navigation |
| `src/deepseek-frame.js`, `src/deepseek-toolbar.mjs`, `src/deepseek-recovery.mjs` | Embedded DeepSeek UI and connection recovery |
| `src/chat-providers.mjs`, `src/native-chat-search.js`, `src/sidebar-history.js` | Provider selection, search, and native history |
| `src/job-page-evidence.mjs`, `src/job-site-adapters.mjs`, `src/job-extraction-core.mjs` | Read-only job extraction |
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

If a live ChatGPT submission fails, open the job's **Details → AI generation &
diagnostics → Copy diagnostics**. The last check records the extension version,
build fingerprint, comparison counts, first mismatch position/type, editor
replacement count, and Send readiness. Capture diagnostics also record reply
and code-block counts, job/run matching, streaming, and completion signals.
It excludes the prompt, response text, page HTML and
conversation URL. These diagnostics survive closing the dock and are retained
while Resume checks an already-prepared prompt. A matching draft is verified and
submitted without reinsertion; a recorded submission attempt is never resent.
