# Clipboard behavior — v2.1.5

## Normal panel submission

```text
Existing click / shortcut
  -> freeze the selected displayed transcript
  -> shared PromptBuilder produces finalText
  -> local navigator.clipboard.writeText(finalText)
  -> await the outcome
  -> send that same finalText to the worker
  -> request ledger -> ChatGPT controller -> unchanged DOM adapter
```

Normal, Detail, STAR, conversation/coding, full-transcript analysis/custom text and panel
F8/F9/F10 share this path. The original templates are not rewritten. Selected transcript rows
are joined with the same space separator as before. The selection is now the displayed snapshot
at click time, not a later reread of evolving caption rows in the worker.

Follow-ups contain their existing instruction text; they do not invent a transcript or copy an
assistant answer. Direct ChatGPT F8/F9/F10 hotkeys copy in their own key handler before insertion.

Clipboard write failure does not block sending. Native rejection first tries a local temporary
textarea/copy operation. It restores the previous active control and selection and removes the
field/listener. Only then, when needed, does the extension-owned offscreen helper run. The
worker authorizes only its own panel and top-frame ChatGPT content scripts for that fallback.
The helper itself accepts only trusted same-extension non-tab messages from the worker.

There is no clipboard read permission, telemetry, clipboard history, new host access or server.
The newest successful write replaces the old system clipboard contents. Other applications,
OS clipboard-history/sync services and subsequent user copies may affect that clipboard.

## Failure and timing rules

A native promise is awaited for up to five seconds. A timeout is a failure/unknown copy outcome,
not success. The operation cannot cancel an already-started browser clipboard write; it does
not start a competing fallback or another local write until that promise settles. A later
rejection does not trigger a stale fallback. An offscreen fallback has its own bounded deadline
and is not part of the normal native-success path.

A missing or stale ChatGPT tab can still prevent submission, but copying has already been tried.
Clipboard failures do not open a blocking modal. The panel status/console receives safe failure metadata. **Do not resubmit an already-sent prompt just to copy it.**

Possible codes include `clipboard_write_denied`, `copy_api_failed`, `copy_command_failed`,
`offscreen_unavailable`, `copy_timeout`, `previous_copy_pending` and `expired`. An error code
alone may not distinguish permission, focus, operating-system or enterprise restrictions.
Do not diagnose the user's machine from a generic code alone.

## Installation acceptance

Export needed transcript data before upgrading. Replace the old unpacked extension files,
reload it at `chrome://extensions`, confirm **2.1.5**, close/reopen the panel and refresh Meet
and ChatGPT tabs. Do not run two installed copies concurrently. No new permissions are added
relative to v2.1.1.

Send one short selected transcript, then paste into a plain-text editor. It should be the full
outgoing template plus the selected text. Test Normal/Detail/STAR and a follow-up as needed.
An existing ChatGPT draft must still be preserved; the copied text may remain even when draft
protection prevents submission. Avoid duplicate ChatGPT sends during testing.

## Native-only diagnostic without submitting anything

The optional `diagnostics/clipboard.html` page is not added to the main panel and does not
change its layout. It tests the native Clipboard API directly, without an offscreen fallback,
so the actual browser rejection is visible instead of being replaced by a later fallback code.

1. At `chrome://extensions`, enable Developer mode and copy this extension's ID.
2. Open this address, replacing `EXTENSION_ID` with that ID:
   `chrome-extension://EXTENSION_ID/diagnostics/clipboard.html`
3. Keep the page focused and click **Test native clipboard**. It replaces clipboard contents
   with `Tech Interview Chat v2.1.5 — native clipboard test`. Paste into a plain-text editor.

The displayed result reports the extension version, secure/focus/visibility state at the
click, and either a resolved write or the actual exception name/message. It neither reads
clipboard contents nor makes network calls. Success here verifies that native write in this
focused extension tab, not all side-panel, OS clipboard-history or ChatGPT integration cases.
Open it as an extension URL, not as a local filesystem HTML file.
