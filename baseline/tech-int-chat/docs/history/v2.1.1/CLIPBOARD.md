# Clipboard feature — 2.1.1

## Exact outgoing text; independent outcomes

The existing `buildPromptText()` produces one final string. That string is sent to the
clipboard bridge before the same string is passed to the existing ChatGPT DOM adapter.
Normal, Detail, STAR, conversation/coding, custom/analysis and both panel/ChatGPT F8/F9/F10
follow-ups retain this path. The original prompt templates and transcript selection logic
are unchanged. The composer may visually normalize whitespace; the clipboard is not
reconstructed from the resulting DOM.

Copy success is not proof that ChatGPT accepted the prompt. A draft-protection error can
prevent sending after a successful copy. Copy failure does not prevent a send attempt.
A successful ChatGPT send with failed/absent copy confirmation now produces an existing-style
alert with a safe diagnostic code. The layout and its hidden status line remain unchanged.
Retried controller requests return retained results instead of copying/clicking Send again.

The normal system clipboard contains the latest successful copy only. No assistant answer,
clipboard history or read-before-write is involved. Other applications/clipboard history or
sync services may access the copied text; replace it manually after sensitive use.

## Runtime pipeline

1. `chatGPT.js` builds and validates the final text and sends `COPY_CHATGPT_PAYLOAD` to the
   worker with an identity and expiry. Its copy deadline is 4.5 seconds; the caller wait is
   5 seconds. Only then does it invoke the original adapter, including after copy failure.
2. `background.js` routes that request before transcript database initialization. Both
   clipboard target messages are ignored by its normal router to avoid competing responses.
3. `ClipboardService` checks Chrome-provided sender identity, top frame and the two existing
   HTTPS ChatGPT origins. Payload size is bounded to 205,000 characters; at most eight requests
   may be queued. Operations share a serialized queue and each request has a deadline.
4. The worker first targets extension pages. Only a focused page responds. `popup.js` uses
   `navigator.clipboard.writeText` when present and waits for resolve/reject. When that API is
   absent it attempts a synchronous legacy copy with an explicit plain-text event, then
   removes the temporary field/listener and restores the prior focus/selection.
5. If no focused page can complete the copy, the worker uses an extension-owned offscreen
   document while the original deadline remains valid. Its legacy copy requires both a true
   command result and the event that supplied the exact plain-text value. Sender checks allow
   only this extension's non-tab contexts, with optional extension URL validation.
6. The worker closes the helper after its operation. The controller propagates the result;
   `RequestManager` saves only `ok`, safe diagnostic code or method, not the outgoing text.
7. The panel and ChatGPT-local hotkeys use the existing alert mechanism if sending succeeded
   but copying failed. No extra Send is triggered just because copying failed.

All expired queued work is rejected before starting a write. A native Clipboard API call
already made cannot be forcibly cancelled or unwritten; it may resolve after a timeout.
A timed-out native panel write consumes the shared deadline, so a concurrent offscreen
fallback is not started for that request. Clipboard outcome is therefore best-effort API
confirmation, not a guarantee against OS issues or another application's later overwrite.

## Why two execution contexts?

A focused extension page can use the modern Clipboard API with the existing `clipboardWrite`
permission. A worker has no DOM, while offscreen documents cannot be focused. The offscreen
fallback therefore uses the extension CLIPBOARD pattern with `document.execCommand('copy')`,
not `navigator.clipboard` in an unfocused worker/helper. The legacy command is deprecated and
is isolated to fallback code; future browser support still needs live acceptance testing.

Version 2.1.1 adds no permissions over 2.1.0. The existing grants are `clipboardWrite` and
`offscreen`, plus the original extension permissions/hosts. There is no `clipboardRead`,
new origin, new visible window, clipboard history, telemetry or new backend.

Platform documentation consulted:
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard
- https://developer.chrome.com/docs/extensions/reference/api/offscreen
- https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender

These describe browser rules; they do not certify this extension on a particular computer.

## Diagnostic codes

| Code | What the extension observed |
|---|---|
| `copy_command_failed` | A legacy command returned false, threw, or did not deliver the required copy event. |
| `clipboard_write_denied` | The focused page's native API rejected with NotAllowedError. A later fallback failure can replace this with its own code. |
| `copy_api_failed` | The focused-page API threw/rejected for another reason. |
| `offscreen_unavailable` | Offscreen APIs/contexts were unavailable or helper creation failed. |
| `clipboard_unavailable` | The browser message/bridge was unavailable. |
| `expired`, `copy_timeout` | The permitted copy window elapsed. This is not proof the OS was never written. |
| `invalid_receipt`, `not_reported` | No matching trustworthy success confirmation was returned. |
| `invalid_sender`, `invalid_request`, `invalid_or_expired`, `busy` | Sender/input/deadline checks or the bounded work queue rejected the attempt. |

Codes report observations rather than proving a machine-specific root cause. Neither permission
changes nor repeated sends should be attempted blindly. The alert deliberately says not to resend
just to copy: manually copy the message already sent to ChatGPT instead.

## Acceptance after upgrading

1. Export needed transcript data. Replace the files in the existing unpacked extension folder,
   reload at `chrome://extensions`, and confirm version **2.1.1**. Do not run two copies.
2. Close/reopen the panel and refresh **both Meet and ChatGPT tabs**. Approve clipboard-write
   permission only if Chrome requests it; this release adds no new grant over 2.1.0.
3. Send one short selected transcript using Normal, then paste into a plain-text editor.
   Confirm that both the outgoing prompt and selected transcript are present in the same order.
4. Repeat Detail, STAR, coding, analysis/custom text and F8/F9/F10 follow-ups. The clipboard
   should contain each action's actual outgoing text, not the prior action or a ChatGPT answer.
5. Submit from the focused panel while ChatGPT is in a background tab. Copying should not
   activate another tab or create a visible helper window. Also test a ChatGPT-local hotkey
   with the panel closed, which exercises offscreen fallback.
6. Test an existing unsent ChatGPT draft: it must remain intact. Copy may have succeeded even
   when draft protection blocks sending. Copy outcome is separate from send outcome.
7. In a controlled permission-denial test, sending should still proceed and a copy warning
   should appear through the existing alert mechanism. Record its diagnostic code and your
   browser version; do not resend an already-submitted prompt merely to obtain a copy.

The supplied unit/DOM tests mock Chrome messages and OS clipboard writes. They verify exact
text, ordering, dispatch/fallback logic, failure reporting and cleanup, not the real system
clipboard, actual offscreen process, or authenticated external websites.
