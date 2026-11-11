# Verification — tech-int-chat v2.1.2

Input: the actual uploaded v2.1.1 ZIP. All commands below were run against the modified full
extension directory; there is no compilation step or external runtime dependency.

## Passed in this environment

- `npm test`: **69/69 unit tests**. Transcript reducers, revision/identity isolation, durable
  request behavior, metadata-only clipboard receipts, shared prompt variants, synchronous native
  invocation, local rejection fallback, bounded offscreen fallback, timeout/late-rejection
  handling, prepared-payload forwarding, stale-version rejection and copy/send deduplication.
- `python tests/browser_dom.py`: **36 Chromium DOM checks** with Chromium **144.0.7559.96**.
  Actual DOM, clicks, keyboard input, selection/focus restoration and adapter insertion; Chrome
  messaging and OS clipboard writes are mocked. Includes missing ChatGPT tab after successful
  copy, copy-before-first-send ordering, unchanged controls, exact payload matching, local
  fallback after native rejection, changing captions during a pending copy, and transport retries
  without another copy. Also reruns Meet capture/revision/cleanup and existing draft protection.
- `npm run check`: manifest and version consistency, all referenced assets/script load order,
  local imports, JavaScript syntax, unchanged permissions/hosts, original visible HTML/CSS,
  original prompt/icon hashes and the original Meet selector block plus 11 extraction functions.
- `v2.1.2-preservation.json`: the entire `meeting.js`, prompts, ChatGPT DOM adapter,
  transcript/storage modules, offscreen document and optional backlog match v2.1.1 byte-for-byte.
  `index.html` differs only by three bundled script-loading tags; stripping those tags restores
  its exact prior bytes.
- Source-based v2.1.1 failure reproductions: see `clipboard-reproduction.json` and
  `scripts/reproduce-v211.mjs`. These use controlled API outcomes/timing, not the user's device.

Raw current outputs: `unit-test-output.txt`, `browser-dom-results.json`, `check-output.txt`.
The input's 51 unit tests were rerun and passed; output is
`v2.1.1-baseline-unit-output.txt`. Older release evidence is historical, not current validation.
The ZIP is checked for integrity and the packaged files are covered by `SHA256SUMS.txt`.

## Actual browser attempt and unverified areas

An isolated-profile unpacked-extension launch of **this v2.1.2 directory** was attempted.
`chrome://extensions/` failed with `ERR_BLOCKED_BY_ADMINISTRATOR`; no extension service worker
was observed. Relevant managed policies block extension installation/navigation and restrict
clipboard access. They were not modified. See `extension-load-attempt.json`.

Therefore **actual installed-extension messaging, native system clipboard writes, real offscreen
creation, IndexedDB integration, MV3 suspension, authenticated Meet/ChatGPT and OS clipboard
history/sync were not end-to-end verified**. A resolved Clipboard API promise is the runtime
confirmation used by the app, not an independent OS readback. No clipboard-read permission was
added. The optional native diagnostic page is provided for a real button-driven test on the
user's browser; it does not send anything to ChatGPT.

`tests/browser_smoke.py` is retained and updated for the prepared payload contract. It requires
local browser navigation and is not claimed as passed in this environment. No CPU/battery,
long-session heap, universal clipboard-success or Chrome Web Store approval claim is made.
