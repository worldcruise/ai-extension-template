# Normal-selection submission investigation — v2.1.3

## Evidence and limits

Inputs are the uploaded original `tech-int-chat.zip` and the actual
`tech-int-chat-updated-v2.1.2.zip`. The user reports that clipboard copying and follow-up work,
but normal selection fails, with one ChatGPT tab open. The screenshot shows a generic
readiness timeout and a successful clipboard receipt. No DOM snapshot or runtime trace from
the authenticated failing page was supplied.

It is not justified to claim that multiple tabs, a specific ChatGPT DOM rollout, prompt length,
Lexical specifically, or document focus definitely caused the reported failure. The v2.1.3
changes fix reproducible adapter defects and make a remaining live failure diagnosable.

## Source comparison

**Original:** `chatGPT.js` uses the same principal editor selector list for normal and follow-up.
Its `setEditorText()` modifies contenteditable DOM directly, dispatches input, and checks a text
prefix. Its background `sendToChatGPTTab()` wraps even an inner error response with the outer
status `Content sent to ChatGPT`; that is not proof of a successful real send. Restoring this
behavior would hide failures instead of fixing them.

**v2.1.2:** `chatGPT.js` routes prepared normal requests and local follow-ups through the same
`ChatGPTAdapter.send()`. The panel joins normal selected transcript rows with spaces, so normal
selection is not inherently multiline. The path does not imply a mandatory tab switch.

`adapters/ChatGPTAdapter.js` tries `document.execCommand("insertText", false, text)`. If it returns
false or the resulting text differs, it clears the contenteditable node and inserts a paragraph
directly. It always dispatches another input event, even if native editing already emitted one.
The adapter then waits up to four seconds for both matching text and an enabled Send button,
using the same generic timeout as the earlier editor lookup.

That leaves a real failure path: the extension can modify the DOM without the controlled editor
retaining that change, then time out before any Send click. A matching DOM string immediately
after mutation is not sufficient evidence of accepted editor input.

## Before/after reproductions

The suite `tests/chatgpt_regression.py` runs the exact v2.1.2 adapter snapshot in
`tests/fixtures/ChatGPTAdapter.v2.1.2.js` and the modified adapter against the same prepared
request and controlled-editor fixture. The content/Chrome boundary is mocked; this isolates the
adapter change rather than claiming a full installed-extension comparison.

| Reproduction | v2.1.2 adapter | v2.1.3 adapter |
| --- | --- | --- |
| Native insertion deliberately refused; controlled editor reverts direct HTML mutation | Generic readiness timeout, zero Send clicks | Page paste handler receives the exact text, one acknowledged click |
| Recognized prompt ID belongs to a wrapper around the editor | Generic readiness timeout, zero Send clicks | Actual writable descendant used, one acknowledged click |
| Focus callback replaces the original composer node | Stale-node failure, zero Send clicks | Replacement reacquired, one acknowledged click |
| Native insertion emits its own input event | One native plus one extra synthetic input event | One native input event only |

The first case explicitly **simulates a native-command refusal**. It reproduces the unsafe
fallback and timeout mechanism, not the reason the user's browser may have refused input.
The last case uses real Chromium native editing events without mocking native refusal.

The targeted suite also checks long Unicode payloads for Normal/Detail/STAR in both modes,
working follow-ups, asynchronous paste handling, node replacement, draft protection, user edits,
voice-button rejection, cancellation and ambiguous acknowledgment without replay.

`tests/chatgpt_isolated.py` uses a real Chromium isolated execution world to run the adapter
against a page-owned paste handler. With transient activation expired, the prepared string
crosses the shared DOM event boundary intact and produces one acknowledged send. This is a
fixture page, not ChatGPT's actual private editor implementation.

## Implemented correction

1. Keep the working clipboard and one-prepared-string pipeline unchanged.
2. Require a visible writable input/editor; do not treat an ID-bearing wrapper as an editor.
3. Offer the string to the contenteditable's paste handler. Synthetic paste has no automatic
   browser insertion, so verify that the page handled it and retained the text.
4. If paste is unhandled and the composer remains empty, try native insertion once. Do not
   clear/rebuild controlled-editor HTML. Do not emit a duplicate input after native input.
5. Reacquire replaced nodes and require the text match to survive a short settling interval.
6. Separately wait for enabled Send, click only once, and verify acknowledgment. Existing
   drafts, ongoing generation and edits made during preparation remain protected.
7. Report metadata for lookup, insertion, Send readiness and acknowledgment through the
   content controller, durable job, panel alert and console. Keep receipts/history bounded.

A recognized Send control is sought within the editor's form when available. The additional
`composer-submit-button` ID is not treated as Send when it represents voice or Stop. No generic
form-submit or automatic Enter-key retry is added. No clipboard read permission, MAIN-world
injection, framework-private API access, new host permissions or backend is introduced.

The adapter does not wait indefinitely for `document.hasFocus()` or force a Chrome window to
become focused. Focus and transient activation are measured, not assumed to be the root cause.
The prepared payload is not rebuilt or copied again by the ChatGPT controller.

## Browser API references

- MDN, Document.execCommand: operations can emit input/beforeinput themselves; the return value
  and availability should not be treated as proof that a controlled application accepted text.
  https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand
- MDN, Element paste event: a synthetic paste does not automatically modify document contents.
  The extension must observe application handling or use a native editing fallback.
  https://developer.mozilla.org/en-US/docs/Web/API/Element/paste_event
- Chrome, Content scripts: isolated worlds have separate JavaScript globals but share the DOM.
  https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome, tabs.update: activating a tab does not itself focus its window. That is not a complete
  diagnosis or universal fix for side-panel-originated editor input.
  https://developer.chrome.com/docs/extensions/reference/api/tabs#method-update

## Verification boundary

76 unit tests, 36 existing Chromium DOM checks, 18 targeted adapter checks and 3 isolated-world
checks passed. See `TEST-RESULTS.md` and the JSON/text outputs for exact scope.

The environment blocks extension installation/navigation by administrator policy. An actual
v2.1.3 unpacked-extension launch was attempted; no extension service worker was observed.
Authenticated ChatGPT/Meet, real extension messaging, OS clipboard integration and actual
MV3 suspension are not end-to-end verified. No universal success-rate claim is made.

To resolve a remaining live issue, use `SEND-DIAGNOSTICS.md`: the terminal stage, insertion
method, retained-text count and click flag identify the point of failure without collecting the
transcript. This replaces further guesses based only on the screenshot.
