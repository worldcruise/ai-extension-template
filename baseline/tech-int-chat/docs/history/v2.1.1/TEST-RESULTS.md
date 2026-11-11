# Validation results — 2.1.1

Source: the actual uploaded complete `tech-int-chat-updated-v2.1.0.zip`. The delivered ZIP
contains the complete updated runtime and supporting files, not a standalone patch.
`v2.1.1-preservation.json` records the input hash and actual changed/new-file inventory.
`v2.1.0-preservation.json` is retained historical evidence for the previous release only.

## Executed and passed

| Check | Result | Actual scope |
|---|---:|---|
| Original 2.1.0 regression suite | 38 unit / 25 DOM checks passed | Re-run before modifications; showed existing tests could pass without proving OS writes or surfacing the lost receipt. |
| Final Node regression suite | 51 / 51 passed | Original core/clipboard tests plus focused-panel/fallback/deadline/receipt/diagnostic regressions. Chrome APIs and storage are mocked where required. |
| Final Chromium DOM suite | 32 / 32 passed | Actual Chromium DOM, original Meet/panel/composer behavior, exact payloads, native API interface resolve/reject, legacy copy events, sender checks, focus/selection restoration and visible failure alerts. Chrome messaging, Clipboard API implementation and OS writes are mocked. |
| Before/after reproduction | Confirmed and corrected | The actual 2.1.0 RequestManager drops a failed-copy result on a successful send; 2.1.1 retains it. |
| JavaScript syntax/imports | 23 files passed | `node --check` across runtime/tests/tool scripts; local imports resolve. |
| Manifest/asset references | 12 references checked | Module worker, package/manifest version agreement, expected permissions/hosts, offscreen document/script existence. |
| Original preservation | Passed | Original HTML/CSS, prompts, three icon files, Meet selector block and 11 original extraction function hashes. |
| 2.1.0 preservation | Passed | Entire meeting.js, index.html, prompts/icons, ChatGPT DOM adapter, transcript/storage modules and optional backlog match the uploaded 2.1.0 package. popup.js is intentionally changed for clipboard handling/reporting; layout and selection logic are retained. |

Node 22.16.0; Chromium 144.0.7559.96. Evidence files: `unit-test-output.txt`,
`browser-dom-results.json`, `check-output.txt`, `clipboard-reproduction.json`,
`preservation.json`, and `v2.1.1-preservation.json`. Baseline outputs are retained separately
as `v2.1.0-baseline-unit-output.txt` and `v2.1.0-baseline-browser-dom.json`.
`SHA256SUMS.txt` covers packaged files.

The contenteditable adapter can normalize displayed whitespace. Exact clipboard input is
checked against the prompt builder; equivalent composer text is checked without asserting
byte-level equality for HTML rendering.

## Attempted, not verified

An actual unpacked-extension Chromium launch of the input 2.1.0 build was attempted during
the recheck. No extension service-worker event
arrived during the observation window. Navigation to `chrome://extensions/` failed with
`ERR_BLOCKED_BY_ADMINISTRATOR`. The browser is managed with an extension blocklist and URL
blocklist; clipboard is restricted by managed policy as well. Those policies were not changed.
`extension-load-attempt.json` records the observed restriction, not a successful extension run.
The original local HTTP/IndexedDB smoke suite is included but was not successfully executed
in this environment. No passing result is claimed for it in this release.

Therefore actual installed-extension/side-panel messaging, real offscreen creation, native
system clipboard writes, IndexedDB integration, MV3 suspension and authenticated Meet/ChatGPT
were NOT end-to-end verified. No performance/battery or universal clipboard-success claim is
made. A resolved API promise is the app's confirmation, not an independent readback of the OS
clipboard; no clipboard-read permission was added.

## Acceptance on the user's installation

Export important transcript data before reload. Confirm 2.1.1, reopen the panel and refresh
Meet and ChatGPT tabs. Send one short selected transcript, then paste into a plain-text editor.
Verify the full outgoing prompt plus transcript. Follow `CLIPBOARD.md` for alternate modes,
closed-panel/offscreen operation, an existing ChatGPT draft, and permission-failure behavior.
If an alert reports failed copying after Send, do not resend merely for copying; copy the
already-submitted message from ChatGPT and record the diagnostic code/browser version.

The storage schema/retention and optional-work backlog have not changed from 2.1.0.
