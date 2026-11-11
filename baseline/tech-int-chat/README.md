# tech-int-chat 2.1.5

Complete unpacked Chrome MV3 extension. This package is based on v2.1.4 and preserves the
original product surface: HTML/CSS, prompt definitions, icons, Meet transcript selectors,
transcript parsing/splitting, and the existing selection/hotkey workflow.

## Install / update

1. Export any transcript you need before upgrading.
2. Extract this ZIP and replace the contents of the current unpacked extension directory.
3. In `chrome://extensions`, click **Reload** and confirm **2.1.5**.
4. Close/reopen the extension panel and refresh both open Meet and ChatGPT tabs.

No runtime build step or dependency installation is required.

## v2.1.5 — submit-state correction

The live v2.1.4 logs showed a consistent pattern: `clicked:true`, the composer had already
cleared to a one-character placeholder, but the adapter kept waiting for ChatGPT-specific
acknowledgment DOM and eventually reported `cancelled` / `submission_not_acknowledged`.
Later attempts could see a second visible ProseMirror and misclassify unrelated content as an
`existing_draft`.

v2.1.5 changes only the clear failure boundary:

```text
freeze exact finalText
  -> copy exact finalText
  -> find the actual composer
  -> verify exact insertion
  -> find enabled Send in/for that composer
  -> click Send exactly once
  -> DONE
```

The extension does **not** wait for a user-message node, Stop button, response generation, or
conversation-route DOM after the verified Send click. Normal ChatGPT navigation after Send no
longer aborts the job. Pre-click protections remain: draft protection, generation/Stop guard,
insert verification, prompt-change detection, request deduplication, and no automatic replay.

Composer discovery now prefers explicit prompt identifiers and then form-local editable nodes.
Broad contenteditable candidates outside a form cannot displace the real composer. Empty
zero-width placeholders (`U+200B` etc.) normalize as empty.

Clipboard behavior from 2.1.2+ is unchanged: the panel builds one immutable final string, copies
that exact string first, and passes that same string to the ChatGPT adapter. Clipboard failure
never triggers an automatic resend.

## Product behavior preserved

- Same panel UI and CSS.
- Same Meet selectors and transcript extraction/splitting logic.
- Same normal / Detail / STAR / coding prompts and F8/F9/F10 follow-ups.
- Same left-click start + right-click end/send selection workflow.
- Same export and Clear controls.
- No assistant-answer scraping was added.
- No new permissions were added in 2.1.5.
- No runtime `alert()` calls; the deliberate Clear confirmation remains.

## Architecture implemented from the refactor plan

- Observer-driven Meet capture with a 10-second recovery check instead of the old 450 ms scan.
- Source-scoped transcript IDs, monotonic caption revisions, stable retry patch IDs, and stale
  revision rejection.
- Transactional chunked IndexedDB transcript storage with bounded row/text/job safety limits.
- Incremental panel row updates and paged startup snapshots.
- Durable ChatGPT request ledger, duplicate/coalesced request protection, immutable prepared
  payloads, and no automatic replay after the side-effect boundary.
- Metadata-only, bounded diagnostics; prompt/transcript text is not logged by diagnostics.

## Verification

The packaged source passed:

- **76** Node unit tests.
- **36** Chromium DOM integration checks.
- **4** focused Chromium regressions derived directly from the v2.1.4 live logs.
- **3** Chromium isolated-world checks.
- MV3 manifest, JavaScript syntax, local-import, no-alert, permission, UI/prompt/icon preservation,
  Meet selector, and 11 protected extraction-function checks.

The focused regressions prove in controlled Chromium that: a Send click no longer waits for
acknowledgment DOM; synchronous post-click DOM teardown does not invalidate the send; a
927-character auxiliary ProseMirror is not chosen over the form-local composer; and a zero-width
empty placeholder is not mistaken for an existing draft.

The environment cannot install the unpacked extension or authenticate to live ChatGPT/Meet, so
those two end-to-end checks remain manual. A local installed-extension smoke attempt was blocked
by administrator policy (`ERR_BLOCKED_BY_ADMINISTRATOR`).

See `docs/TEST-RESULTS.md` and `docs/FINAL-AUDIT-v2.1.5.md`.

## Data / privacy

Transcript chunks are stored locally in IndexedDB under the extension profile. No new backend,
telemetry, analytics, credentials, or clipboard-read permission is introduced. The extension
sends the prepared text to the already-open ChatGPT website only when the existing send/
analysis/follow-up workflow is used.

## Optional future work

The previously discussed optional items remain intentionally out of this bug-fix release:
automated live-site integration coverage, broader MV3 suspension testing, performance profiling,
TypeScript migration, CI validation, and possible transcript-list virtualization. See
`docs/BACKLOG.md`.
