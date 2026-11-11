# v2.1.5 — submit-state and composer-targeting correction

- Stop treating ChatGPT conversation DOM as a required post-click acknowledgment. After exact
  insertion verification and one enabled Send click, the submission is complete from the
  extension's perspective.
- Remove service-worker `tabs.onUpdated(...loading...)` cancellation that aborted normal
  ChatGPT route/navigation transitions after Send.
- Remove the ChatGPT content controller `pagehide` abort that could cancel a request during a
  legitimate post-submit unload.
- Tighten composer discovery: broad ProseMirror/contenteditable candidates must be form-local;
  explicit prompt identifiers remain preferred, and conversation-turn editors are rejected.
- Normalize zero-width editor placeholders so an empty composer is not misclassified as a draft.
- Preserve the existing draft/generation/prompt-change checks before the Send boundary and
  preserve exactly-once request/deduplication behavior.
- Add the `submitted` / `submission` diagnostic receipt to the sanitized allowlist.
- No UI, Meet selector/parser, prompt, clipboard flow, permission, storage schema, or automatic
  retry change.

Verification: 76 unit tests, 36 Chromium DOM checks, 4 focused v2.1.5 submit regressions, 3
isolated-world checks, and static/preservation checks passed. Live authenticated ChatGPT/Meet and
native installed-extension testing are not available in this environment.

# v2.1.4 — submit fix + non-blocking runtime errors

- Fixes the reproduced ChatGPT case where the prepared text was accepted but submission never happened because the live composer used a plain `button[type="submit"]`. The generic selector is restricted to the verified composer form.
- Keeps the one-click/no-replay submission boundary and acknowledgment checks.
- Removes runtime `window.alert()` calls from panel, Meet capture and ChatGPT hotkeys so errors/warnings cannot block execution. User-confirmation for destructive transcript clear remains.
- No UI, prompt, Meet selector, transcript parsing/splitting, clipboard, storage or request-lifecycle redesign.

# v2.1.3 — ChatGPT insertion correction and stage diagnostics

- Preserves the working prepared-payload/clipboard flow and original main UI/Meet code.
- Removes destructive contenteditable HTML replacement after native insertion failure.
- Uses the page editor's paste handler when supported, otherwise native insertion into an empty
  editor; verifies retained text rather than trusting a return flag or transient DOM mutation.
- Removes duplicate synthetic input after native insertion already emitted input.
- Finds a writable editor inside a recognized wrapper; skips disabled/read-only editors.
- Reacquires composers replaced during focus or input processing.
- Supports the explicit composer-submit Send control while rejecting its voice variant.
- Distinguishes lookup, insertion, Send readiness and acknowledgment errors. Stage metadata
  propagates into durable job receipts and the existing panel error mechanism.
- Adds bounded, metadata-only console logs with action/source and request ID; no raw text.
- Retains draft/Stop protection, cancellation and no-replay behavior after a Send click.
- Updates content handshake to 2.1.3 and bounds the content response to 38 seconds.
- Adds before/after adapter regressions, diagnostic allowlist tests and isolated-world tests.

The runtime trigger on the user's authenticated page has not been independently observed.
Reproductions and limitations are documented in docs/SEND-REVIEW.md.

# v2.1.2 — direct copy of a single prepared payload

- Build the exact final text in the initiating panel before asynchronous ChatGPT work.
- Copy from the original click/key handler; send the same immutable finalText through the
  worker and content controller without rereading evolving transcript rows or rebuilding it.
- Fix skipped local fallback after a settled native Clipboard API rejection.
- Remove the ChatGPT -> worker -> panel clipboard bounce; offscreen remains fallback-only.
- Retain clipboard receipts through pre-dispatch failures and preserve safe native/fallback codes.
- Keep request replay safe: retries reuse payload/identity and never trigger a second copy.
- Share prompt construction with direct ChatGPT hotkeys; preserve all prompt definitions.
- Add an optional native-only diagnostic page; no main-panel UI or permission change.
- Add failure reproductions and regression coverage. 69 unit / 36 DOM checks passed;
  native OS clipboard and actual installed-extension operation remain unverified here.

# Changelog

## 2.1.1 — Clipboard result and fallback correction

Built from the actual uploaded complete 2.1.0 package; not a partial patch.

- Reproduce and fix lost clipboard receipts: `RequestManager` now saves a validated,
  metadata-only clipboard result alongside ChatGPT send success/failure. It never stores
  clipboard text in job receipts. `docs/clipboard-reproduction.json` shows the before/after.
- Try a focused extension panel first, using `navigator.clipboard.writeText` when available.
  Wait for its real promise rather than assuming success. Retain synchronous legacy handling
  when that API is absent and the offscreen fallback when no focused panel can complete it.
- Keep panel/offscreen requests serialized under one deadline. Never start offscreen fallback
  after a native panel write consumes that deadline; the native call itself is not cancellable.
- Validate offscreen/panel senders by extension identity and absence of tab context; allow
  trusted extension-root or absent optional sender URL metadata rather than requiring a
  particular service-worker filename URL. This is hardening, not a proved cause on a user's PC.
- Require both a successful copy command and a copy event providing exact `text/plain` data
  in the legacy paths. Clean temporary elements/listeners and restore panel focus/selection.
- Retain safe clipboard diagnostics throughout the worker/controller/job/panel path. A
  successful send with failed copy now uses the existing alert mechanism; ChatGPT hotkeys
  receive the same warning. No hidden-status-only success claim or automatic resend.
- Increase the copy deadline to 4.5 seconds and controller wait to 5 seconds. Require the
  2.1.1 ChatGPT content handshake after upgrade so an old tab explicitly requests refresh.
- Add failure-receipt, focused-panel, stale/late-write, sender, missing-copy-event and UI-alert
  regressions. The complete rerun passes 51 unit tests and 32 Chromium DOM checks. Chrome
  messages and OS writes remain mocked; actual extension/system-clipboard use is unverified.
- Preserve HTML/CSS/layout, prompts, icons, all of `meeting.js`, the ChatGPT DOM adapter,
  transcript/storage modules and optional backlog. No new permissions, schema or build step.

## 2.1.0 — Clipboard before ChatGPT submission

Built from the complete uploaded 2.0.0 package. All existing runtime files remain included.

- Copy the exact assembled outgoing prompt/transcript as plain text before invoking the
  existing ChatGPT adapter, including custom/analysis and follow-up actions.
- Add `ClipboardService` and a temporary offscreen clipboard document for background-tab
  operation without focusing another page. Never read the clipboard or persist another copy.
- Add `clipboardWrite` and `offscreen` permissions; no new host grants or clipboard-read grant.
- Keep copy failure non-fatal, use deadlines to reject stale clipboard writes, serialize helper
  creation/write/close, bound queued requests, validate origins/frame IDs/request size, and
  keep sensitive text out of logs. Preserve existing request replay protection.
- Route offscreen responses separately from normal background messages and bypass transcript
  database initialization for the clipboard-only operation.
- Add a capability handshake so an old 2.0.0 ChatGPT content script asks for a tab refresh
  rather than silently sending without the new copy feature. Allow the tab-response timeout
  to accommodate the bounded clipboard attempt.
- Add 19 clipboard/worker/controller unit tests and seven additional Chromium DOM checks.
  The complete rerun passed 38 unit tests and 25 DOM checks; OS clipboard is mocked in these
  checks. Actual installed-extension/OS-clipboard behavior remains a manual acceptance step.
- Preserve `index.html`, all CSS, `popup.js`, all of `meeting.js`, the original ChatGPT DOM
  adapter, prompt definitions, icons, existing storage/schema, and optional-work backlog.

No runtime build, package-manager dependencies, UI redesign or transcript selector changes.


## 2.0.0

This is a complete runtime update, not the original baseline and not a standalone patch.
The manifest version is deliberately higher than the uploaded 1.5.1 package.

### Added

- Functional core and service modules for transactional transcript handling, source identities,
  request deduplication, recovery, cancellation, quota guards and message serialization.
- A separate ChatGPT DOM adapter, loaded by the manifest and reinjection path.
- IndexedDB storage with 128-row chunks, indexes, paged reads and session-token lifecycle.
- Tests, preservation checks, installation notes, validation limitations and optional-work backlog.

### Changed

- `manifest.json`: 2.0.0, module service worker, Chrome 116 minimum, adapter script order.
  Permission and host lists are unchanged.
- `background.js`: replaces global shared arrays and delayed full snapshots with real services.
- `meeting.js`: keeps extraction helpers intact; adds observer-first scheduling, raw-caption
  revision groups, reliable queue acknowledgment, generation handling and lifecycle cleanup.
- `chatGPT.js`: keeps prompt selection; adds bounded retained request results and cancellable
  adapter execution. Automatic Stop clicks and unconditional draft replacement are removed.
- `popup.js`: incremental rows, indexed selections, reconnecting snapshots, durable send jobs,
  safe late callback handling and clear-generation race protection.

### Preserved exactly

- `index.html` / all embedded CSS.
- `gptPrompts.js` / prompt strings.
- All three original icon files.
- The Meet selector block and the original query, visibility, discovery/scoring, row-parsing,
  DOM-row ID and caption-splitting function bodies, as checked by `npm run check`.

### Deliberate limits

No assistant-answer extraction, remote feature flags, analytics telemetry, new credentials,
new server, multi-meeting tab-picker UI, TypeScript conversion or DOM virtualization was added.
Runtime errors and uncertain submission states are surfaced rather than hidden behind retries.
