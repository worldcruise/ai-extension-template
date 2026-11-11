# Clipboard recheck — 2.1.0 to 2.1.1

## Confirmed defect

The original ChatGPT controller included a clipboard result, but `RequestManager.run()`
discarded it when saving a successful submission. The panel then treated job success as
"Content sent to ChatGPT" without surfacing a failed copy. Its existing status line is hidden,
so merely changing that text would not have made failure visible either.

The same controlled execution was run against the actual 2.1.0 and 2.1.1 RequestManager files:

```json
{"status":"Content sent","clipboard":{"ok":false,"code":"copy_command_failed"}}
```

2.1.0 stored `status: succeeded` without a clipboard field. 2.1.1 stores `status: succeeded`
with `{ok:false, code:"copy_command_failed"}`. This means a send can still succeed as required,
but the caller can distinguish and display failed copying. The included
`clipboard-reproduction.json` records the compared outcomes.

## Additional issues and changes

The 2.1.0 copy path depended solely on offscreen execution. Version 2.1.1 first tries a
focused extension page using the native API, and retains offscreen fallback for the other
cases. A promise is awaited rather than declaring a native copy successful immediately.
Legacy paths now require the copy event to supply text in addition to a true command return.
The controller preserves safe diagnostics and the ledger stores only outcome metadata.
The existing alert mechanism surfaces failed copying after a successful send.

Optional sender-URL handling was relaxed from an exact service-worker filename to the
same-extension non-tab boundary. This accommodates optional/root URL metadata while rejecting
content-script senders. It is a defensive correction, not a verified cause of a user's failure.
Deadlines are checked before dispatch, but cannot cancel a native write already started.
No offscreen fallback races a native write that consumes the request's deadline.

## What this does not establish

This recheck does not establish why copying failed or succeeded on the user's particular
browser/OS. Original tests could pass despite the reporting defect because they mocked OS
writes. The new tests still cannot prove native system clipboard operation. The managed browser
here blocks extension installation/navigation; no claim of real installed-extension, real
clipboard, live Meet/ChatGPT, or MV3 lifecycle verification is made.

## Preservation and evidence

The complete 2.1.0 package is the input, not an earlier baseline or partial build. The complete
2.1.1 output includes every runtime file, tests and docs. HTML/CSS, all of meeting.js, prompts,
icons, the ChatGPT DOM adapter, transcript/storage modules and optional backlog are byte-for-byte
preserved. popup.js changes only clipboard handling/result alerts; its existing layout and
transcript selection logic remain. See v2.1.1-preservation.json and TEST-RESULTS.md.
