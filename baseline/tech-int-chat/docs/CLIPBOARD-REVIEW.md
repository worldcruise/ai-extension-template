# Clipboard investigation and correction — v2.1.2

## Evidence, not a guessed machine diagnosis

Input: the uploaded `tech-int-chat-updated-v2.1.1.zip`. The input SHA-256 and unchanged
runtime files are recorded in `v2.1.2-preservation.json`.

The user's exact browser/OS rejection was not supplied and is **not established** by this
review. The earlier explanation that the bridge was simply "overengineered" was too certain:
multiple asynchronous calls do not themselves prove a failure, and Chrome explicitly supports
an offscreen clipboard pattern. This release fixes concrete failure paths found in the code.

## Reproduced problems in the actual v2.1.1 source

1. **Copying depends on ChatGPT setup succeeding first.** The panel sends selected IDs to
   `ChatGPTService.submit()`, which looks up a ChatGPT tab and checks its content-script
   handshake before `chatGPT.js` can build the final string and request copying. With no
   ChatGPT tab, submission rejects and no clipboard call occurs. A stale/failed handshake
   similarly prevents that later copy step. Reproduced with the actual service and an empty
   tab-query result: `No ChatGPT tab found`, zero clipboard attempts.
2. **A rejected native call bypasses the local legacy fallback.**
   `installPanelClipboardBridge()` in v2.1.1 returns an asynchronous failure receipt when
   `navigator.clipboard.writeText()` rejects. Its local `execCommand` branch runs only when
   the modern API is absent, not when it rejects. Reproduced by rejecting the native promise
   with `NotAllowedError`: `clipboard_write_denied`, zero local legacy attempts. Whether a
   legacy attempt succeeds depends on the actual browser restrictions; it is not guaranteed.
3. **The single panel/offscreen deadline can eliminate fallback.** A negative or unresolved
   panel response can consume the entire 4.5-second budget. The service then returns `expired`
   without creating the offscreen helper. Reproduced with a controlled clock and the actual
   `ClipboardService`. This demonstrates the deadline behavior, not a measured delay on the
   user's machine.

`clipboard-reproduction.json` contains the actual controlled outputs. To rerun against an
extracted old build:

```sh
node scripts/reproduce-v211.mjs /absolute/path/to/v2.1.1/tech-int-chat
```

The old 51 unit tests passed again during this investigation; they did not establish native
clipboard reliability. The new tests assert the corrected action ordering and fallback paths.

## Implemented correction

The initiating panel now loads the unchanged prompt definitions and a shared synchronous
`PromptBuilder` before its event handlers. It captures the selected displayed rows, builds one
final string, and calls the local `ClipboardWriter.copy()` in the original click/key handler,
**before any asynchronous ChatGPT request**. The same immutable `finalText` is then sent through
the service and adapter. Neither the worker nor the ChatGPT controller rereads/rebuilds it.

A missing/stale ChatGPT tab therefore cannot prevent that earlier copy. Live caption revisions
arriving during copying cannot change the submitted text. Clipboard failure remains non-fatal.

Native copying is tried first. A settled rejection or synchronous exception now tries a local
legacy copy while preserving/restoring the focused control and selection. Only failure of both
local methods invokes the existing offscreen fallback, directly, without another panel bounce.
The legacy paths remain fallback-only; `execCommand` is deprecated and is not presented as a
universal replacement for the modern API.

If a native promise times out, no fallback is raced against that unresolved write. New local
writes remain blocked until it settles; a late rejection cannot trigger a stale fallback.
A native OS write already handed to the browser cannot be forcibly cancelled, including after
an extension timeout. This limitation is reported, not hidden behind an "exactly once" claim.

Direct F8/F9/F10 hotkeys in the ChatGPT tab use the same shared builder and copy helper in that
key event. Prepared incoming panel messages are not copied a second time. Transport retries
reuse the same request ID, payload and receipt without initiating another copy.

Metadata-only receipts retain `ok`, method/API and safe native/fallback error codes. Prompt text
is not added to the job database. Existing failure alerts remain; no new main-panel controls,
CSS, selectors or transcript-extraction changes were made. `index.html` adds only three local
script tags. The entire `meeting.js`, prompt definitions and ChatGPT DOM adapter are unchanged.

## Verification boundary

See `TEST-RESULTS.md`. The actual Chromium extension-loading attempt was blocked by managed
policy (`ERR_BLOCKED_BY_ADMINISTRATOR`; extension/URL blocklists and clipboard restrictions).
No policy was modified. Browser DOM tests mock OS writes and Chrome messaging. They verify
code behavior, not system clipboard ownership, OS synchronization, authenticated ChatGPT/Meet,
or actual installed-extension operation.

For a real native-only check on the user's browser, the package includes
`diagnostics/clipboard.html`. It writes a harmless marker directly from its button, displays
focus/security state and the real API error name/message, and sends nothing to ChatGPT. It does
not read the clipboard. See `CLIPBOARD.md` for opening that extension-owned page.

## Platform references

- Chrome offscreen support and lifecycle: https://developer.chrome.com/docs/extensions/reference/api/offscreen
- Clipboard contexts, permissions and focus: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard
- Asynchronous message responses: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
