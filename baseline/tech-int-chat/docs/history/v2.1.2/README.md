# tech-int-chat — complete updated extension 2.1.2

This is the full unpacked extension built from the supplied v2.1.1 package. No compilation,
npm install, API key, server or additional runtime download is needed. Load the directory
containing `manifest.json`, not the ZIP or its parent directory.

## Install / update

1. Export transcripts you need before upgrading; extension reload/update can clear the session
   token that governs this extension's transcript retention.
2. Extract the ZIP. Replace the contents of the existing unpacked extension directory and click
   **Reload** at `chrome://extensions`. Alternatively, disable the old copy and use **Load
   unpacked** on this `tech-int-chat` folder. Do not run two installed versions at once.
3. Confirm **2.1.2**, close/reopen the extension panel, and refresh open Meet and ChatGPT tabs.

The minimum declared Chrome version remains 116. Permissions and host access are unchanged
from v2.1.1, including the existing `clipboardWrite` and `offscreen` permissions. No clipboard
read permission is requested. This is not a Chrome Web Store-reviewed release.

## Clipboard fix in 2.1.2

The previous version waited until the ChatGPT controller to construct/copy its final string.
ChatGPT setup failure could prevent copying altogether. Its native-copy rejection path also
skipped the local legacy fallback. These are reproduced code defects; the user's exact
browser/OS rejection was not established. See `docs/CLIPBOARD-REVIEW.md` for the evidence.

Now the panel does this directly from the existing click/key handler:

```text
Build and freeze the final prompt + selected transcript
    -> copy locally
    -> send that same finalText
    -> ChatGPT adapter (no prompt rebuild and no second copy)
```

Native `writeText` is called before any asynchronous ChatGPT work. A settled native rejection
tries a local legacy copy; only failure of both local methods uses the existing offscreen
fallback. A copy failure still allows sending, and the existing alert reports safe diagnostics.
A missing/stale ChatGPT tab no longer prevents the earlier copy attempt. Copy success is
reported separately from submission success. No automatic replay of an ambiguous send is added.

Normal, Detail, STAR, conversation/coding, analysis/custom text and follow-ups retain their
existing templates. Direct ChatGPT F8/F9/F10 hotkeys copy from their own key handler. The latest
successful write replaces the clipboard; this is not clipboard history. Other programs/OS
clipboard services can access or replace clipboard contents. Do not resubmit a sent prompt
merely to copy it.

## Preserved product surface

All existing visible markup, CSS, controls, selection workflow and transcript-selector/parser
logic are unchanged. The **entire `meeting.js`**, `gptPrompts.js`, ChatGPT DOM adapter,
transcript/storage modules and optional backlog are byte-for-byte preserved from v2.1.1.
`index.html` adds only three script tags to preload shared prompt/copy code before `popup.js`.
No main-panel button or layout element was added.

The single shared transcript panel, colors, left-click start/right-click end-and-send,
Shift+right-click STAR, Ctrl/Cmd+right-click Detail, Escape, F8/F9/F10, export, analysis and Clear
remain. This does not add separate per-meeting UI views.

## Verification and a native clipboard check

69 unit tests and 36 Chromium DOM checks passed, plus syntax, references, permission and
preservation checks. DOM tests mock Chrome messaging and OS clipboard writes. The installed
browser blocks unpacked-extension loading/navigation by administrator policy, so **real system
clipboard operation and authenticated Meet/ChatGPT were not end-to-end verified**.
See `docs/TEST-RESULTS.md` for exact scope and evidence rather than interpreting test counts as
a guarantee on every computer.

To isolate native copying without sending a prompt, use the optional
`diagnostics/clipboard.html` extension page. Its button copies a harmless marker and displays
the actual native API error/focus state. Opening instructions are in `docs/CLIPBOARD.md`.
It does not read the clipboard or contact ChatGPT and is not added to the main panel.

## Implemented changes

- **Transcript correctness:** source-tab/source-instance-scoped IDs; monotonically increasing
  caption revisions; stable patch IDs across retries; one in-flight batch; matching-revision
  acknowledgments; rejection of stale revisions; complete caption-group replacement removes
  obsolete split suffixes without deleting history when a DOM caption disappears.
- **Clear correctness:** persisted generation numbers reject pre-clear work. Repeated/stale
  Clear messages cannot erase new-generation data. A late Clear response cannot wipe newer
  rows already delivered to the panel.
- **Capture scheduling:** the 450 ms scan is replaced by caption MutationObserver events,
  60 ms coalescing, structural container rediscovery, and a 10-second recovery check. Known
  selectors, visible-row limit, parsing and splitting are unchanged.
- **Storage:** transactional IndexedDB chunks of 128 rows, small row/caption indexes, paged
  reads, and writes limited to affected chunks. Acknowledgments follow durable transaction
  completion. Empty chunks are removed. No full transcript is kept in a background array.
- **Panel performance:** changed-row updates instead of moving every row on each patch;
  retained ID index and selection markers; paged startup snapshots; live stream reconnection
  with backoff; no once-per-second transcript polling. Selection is still ID-based; sends now freeze the selected displayed text into one prepared payload.
- **ChatGPT jobs:** durable request receipts, completed-request deduplication, durable aliases
  for double-click coalescing, serialized submission, sender validation, bounded history,
  explicit pre-dispatch/dispatch/acknowledged phases, recovery classification and cancellation.
- **Composer safety:** retains prompt text, supports textarea/contenteditable editors, waits
  for conditions rather than fixed sleeps, verifies insertion, does not overwrite an existing
  draft, does not click Stop on an existing response, clicks Send once and checks submission
  acknowledgment. Ambiguous post-click failures are not automatically replayed.

The original integration **submits prompts; it does not retrieve assistant answers into the
panel**. This release retains that behavior. The new acknowledgment check confirms visible
submission, not answer completion or answer quality.

## Data retention and privacy — important

Unlike the original memory-only session snapshot, transcript chunks now live in **local
IndexedDB**, which can write to disk. There is no application-level encryption, telemetry,
remote logging, new backend, or new upload destination. Text is sent to the existing ChatGPT
website only when the existing send/analysis/follow-up workflow is invoked.

A `chrome.storage.session` token ties the database to the current loaded browser-extension
session. Worker restarts with the same token preserve the transcript. On the next initialization
after browser restart, extension disable/reload/update or token removal, the old database
contents are purged and a fresh transcript is started. **Physical database data can remain on
disk between browser close and that next initialization.** Use **Clear** before closing when
immediate application-level deletion matters. Deletion is not a forensic secure-erase guarantee.
Closing an individual Meet tab does not erase the shared transcript.

A best-effort legacy migration exists only when the earlier snapshot is still accessible under
the same extension identity. It is transactional, but normal extension upgrades can clear that
snapshot before migration is possible. Always export first.

## Limits and operational behavior

The service worker does not hold the whole history, but the unchanged panel still retains its
loaded rows and DOM elements. **Panel memory remains proportional to transcript length.**
Virtualization is deliberately not implemented because it can change scrolling/selection.

The database accepts at most 100,000 live rows or 32,000,000 text characters; these are safety
ceilings, not a claim that the panel stays fast at that size. Browser disk quota can be reached
first. Capture limits include 800 recent raw captions, an 800-group / 2 MiB unacknowledged
text buffer and 65,536 characters per raw caption. Prompts are limited to 200,000 characters.
A full retry buffer pauses new capture while retaining queued captions; delivery recovery
resumes capture. Captions that disappear from Meet while capture is paused cannot be recovered.
Storage/safety errors retain buffered work until an explicit Clear or document shutdown.
Read the error/alert rather than assuming a failed capture or submission succeeded.
Download and Clear between long sessions.

Only recent job receipts are retained (bounded to 128 records, including aliases). Deduplication
is not an unlimited, permanent exactly-once guarantee. If a send is marked **uncertain**, inspect
ChatGPT before starting another send. Cancellation after a click cannot retract a prompt or
stop server-side generation. The extension never automatically clicks Stop to conceal that.

The DOM integrations still depend on the supplied Meet selectors and ChatGPT's website DOM.
Keeping those selectors unchanged does not guarantee compatibility with future website changes.
Refreshing a Meet document starts a new source instance, as in the original capture model.

## Test evidence

See `docs/TEST-RESULTS.md` and the included machine-readable/offline output files.

```sh
npm test
npm run check
```

No dependency installation is needed for those commands (Node.js 20 or newer).

Optional browser regression runner:

```sh
python tests/browser_dom.py --chromium /path/to/chromium
```

It requires Python 3 plus Playwright. It uses real DOM behavior and mocked Chrome messages;
it does not connect to Meet/ChatGPT. `tests/browser_smoke.py` additionally exercises the actual
IndexedDB services and background/panel integration with mocked Chrome APIs on a local HTTP
origin; that larger suite was **not executed successfully in the delivery environment** because
browser navigation was blocked by administrator policy. It remains available to run locally.

## Source layout

`shared/PromptBuilder.js` is the single synchronous prompt builder;
`shared/ClipboardWriter.js` writes from the initiating panel or direct ChatGPT hotkey.
`popup.js` renders the existing UI and freezes/copies/submits one payload.
`services/ChatGPTService.js` validates/forwards prepared text through the durable job manager;
`chatGPT.js` sends it without rebuilding/recopying it. `services/ClipboardService.js` and
`offscreen/` are fallback-only. `diagnostics/` contains a manual native-only clipboard test.
All original core capture, transcript, storage and adapter modules remain in their existing
locations. Tests, evidence and the unchanged optional-improvements backlog are included.

## Platform references

- https://developer.chrome.com/docs/extensions/reference/api/offscreen
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard
- https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- https://developer.chrome.com/docs/extensions/reference/api/storage
- https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world

Platform documentation describes browser behavior, not independent certification of this package.
