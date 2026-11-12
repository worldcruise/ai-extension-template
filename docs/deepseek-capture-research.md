# DeepSeek capture investigation

Investigated on 2026-11-12 against version 0.10.0. The reported symptom is a submitted job remaining on **Generating documents**. The exact affected browser session was unavailable; its diagnostics have been requested. Findings below distinguish reproduced code defects from hypotheses about that session.

## What the status actually means

The tab runner sets `generating` when it sees an answer node or a generation indicator. That status is not evidence that DeepSeek is still writing. Capture additionally requires a posted user-message anchor, a recognized conversation URL, nonempty extracted text, no active generation indicator, 1.5 seconds without text changes, and completion evidence.

New DeepSeek runs use `outputFormat: null`. A complete JSON object matching the job and run already provides completion evidence, even without a Copy button. Missing Copy alone does **not** explain this failure. The service separately validates the captured documents and candidate facts before accepting them.

## Reproduced defects

The research probe executes the actual adapter with the existing deterministic DOM harness. It is not a signed-in browser test. Before changes, three controls passed and four failure scenarios were reproduced in `artifacts/deepseek-capture-research/capture-results.json`:

| Structure or condition | Result before repair |
| --- | --- |
| `<pre><code>` JSON, with or without Copy | Ready |
| `<pre><span>` JSON without surrounding labels | Ready through whole-answer fallback |
| `<pre><span>` JSON plus language/Copy/Download labels and an unlabelled sibling toolbar | Blocked: `waiting_for_completion`, `responseMatched: false`, `codeBlocks: 0` |
| An introductory markdown section before the JSON section | The first section wins; later JSON is missed |
| An unrelated `Stop audio playback` control | Blocked: `waiting_for_idle` despite matching complete JSON |
| An unrelated visible streaming attribute elsewhere in the page | Blocked: `waiting_for_idle` |

The central failure is a combination. `generation-dom.js` extracts only `pre code`; other code markup falls back to the entire answer text. Labels then make JSON parsing fail. `generation-deepseek.js` looks for labelled Copy controls inside the message, missing sibling or lazily mounted controls. Neither completion path succeeds.

Selecting `nodes[0]` also assumes each answer has one markdown node. A repair must collect parts of the **same response**, preserving the next-user boundary. It must not scan other conversations or replace an invalid first response with a later matching one.

Separately, DeepSeek is excluded from the service's periodic health check. If reporting a result and the subsequent error both lose transport, the tab runner can exit while the persisted phase remains `generating`. The five-minute observation timeout cannot update that stored status after the observer exits. A passive heartbeat check can expose this condition without restoring automatic tab recovery or sending again.

## Reference evidence

The references were reviewed at pinned revisions. Downloaded HTML was inspected as data and not executed.

- [Windows-Feilulu browser adapter, revision b9c2725](https://github.com/Windows-Feilulu/deepseek-browser-agent/blob/b9c27254d4341f3dfe9bd63074b040d3b6c05ec4/src/browser.js#L297) polls stable response text and generation indicators. Its renderer handles `pre` with or without a `code` child. Its broad last-message selection, loading selectors, and timeout return should not replace this extension's job/run binding.
- [NewComer00 adapter, revision 90afa51](https://github.com/NewComer00/deepseek-chatbot/blob/90afa51bd6c38dc49234aa97cf07e2daaea2f2f6/deepseek_chatbot.py#L72) uses Enter, markdown counts, and four unchanged HTML polls. It does not supply the reasoning or turn isolation needed here.
- [September 15 DeepSeek capture provenance](https://github.com/NIyueeE/deepseek-user-message-renderer/blob/a0c1a7f87a0a8893bfc0a9b66cd8bac8d9b0caae/test/fixtures/deepseek-chat.provenance.json) and its [documented assistant layout](https://github.com/NIyueeE/deepseek-user-message-renderer/blob/a0c1a7f87a0a8893bfc0a9b66cd8bac8d9b0caae/src/deepseek-user-message-renderer.user.js#L1287) provide stronger markup evidence: highlighted spans inside `pre`, an assistant action row beside `.ds-message`, unlabelled action buttons, and a reply without an action row because controls mount lazily. That capture includes a userscript's additions, so it is not pristine native markup or proof of today's affected session.

The renderer source also describes newer hashed thinking classes. The downloaded capture retains `.ds-think-content`; those newer classes remain an unconfirmed compatibility hypothesis. Prefer the positive `.ds-assistant-message-main-content` selector over adding unexplained hash selectors.

## Why prior checks missed this

All 89 existing adapter, runner, and service tests passed before repair. The browser fixture always gave DeepSeek a `pre code` block and a labelled Copy button inside an `article`. It removed the Stop button when done and did not model native sibling toolbars, token spans, or audio controls. Those tests verified their simulated layout, not live DeepSeek compatibility.

## Repair and validation plan

1. Extract visible `pre` text, including syntax-highlight spans, from the bound assistant response. Exclude toolbar text and reasoning. Prefer the dedicated final-answer container; combine markdown parts only within that response.
2. Treat matching complete JSON as completion evidence while retaining idle and stability checks. Find labelled final-response controls in a bounded sibling toolbar when present. Do not require hover controls or treat arbitrary unlabelled buttons as completion.
3. Scope streaming/loading evidence to the bound response and composer; distinguish Stop generating from audio controls. Keep genuine generation indicators blocking capture.
4. Expose expired DeepSeek heartbeats as Tracking paused with Resume. Keep one active DeepSeek job, persisted submission intent, and manual observation recovery. Do not resend a submitted prompt.
5. Record extraction method, response-part count, generation-indicator reason, completion basis, conversation availability, and stability time as bounded diagnostics. Preserve invalid output for review when there is final-response evidence.
6. Add sanitized browser fixtures derived from the documented structure: token spans, labels, absent/unlabelled sibling controls, several answer sections, reasoning plus final answer, real streaming, audio controls, reload, and stale heartbeat recovery. Run both providers' regression suites.

The live diagnostics remain the confirmation step. Fresh `waiting_for_completion` with no recognized blocks points to extraction/completion. Fresh `waiting_for_idle` with matching JSON points to generation indicators. Old `checkedAt` points to lost tracking. `artifacts/deepseek-capture-research/page-probe.js` is an optional read-only DOM-shape probe that returns counts and structure rather than prompt/response text.

## Implementation

Version 0.10.1 implements the plan in the DeepSeek adapter, shared runner diagnostics, and passive service health reporting. Shared ChatGPT extraction and sending are unchanged. The adapter continues to require the posted prompt; it does not use arbitrary later JSON as a substitute for the correct response. The two-separate-response research case remains deliberately distinct from several markdown sections inside one response: later responses cannot replace an invalid first response.

The regression tests use synthetic job data in sanitized structures, not a copied conversation. They exercise absent and unlabelled controls, highlighted spans, section grouping, final-answer preference, unrelated audio, actual streaming, labelled sibling controls for invalid output, and recovery from an expired heartbeat. Native page fixtures previously missing from the test suite are now part of both the DeepSeek and combined-provider browser suites. No live-account success is inferred from these fixtures.

Validation completed: 251 unit/build tests passed. The expanded single-tab DeepSeek browser suite passed, followed by the combined ChatGPT/DeepSeek suite including native-layout fixtures and paused-observer recovery. Recovery retained the original tab and submission intent, captured the finished response, and asserted exactly one total provider submission. Versions match at 0.10.1 and the unpacked build is available in `dist/extension`.
