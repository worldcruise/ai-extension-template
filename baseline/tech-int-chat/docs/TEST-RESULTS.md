# Verification — tech-int-chat v2.1.5

## Passed

- `npm test`: **76 / 76** Node tests passed.
- `npm run check`: PASS — MV3 manifest/references, JavaScript syntax, local imports, unchanged
  permissions, preserved original UI/CSS/prompts/icons, unchanged Meet selector block and 11
  protected extraction functions, no runtime `alert()`, scoped ChatGPT submit fallback,
  navigation-safe submission, composer scoping, zero-width normalization.
- `python tests/browser_dom.py`: **36 / 36** Chromium DOM checks passed.
- `python tests/v215_submit_regression.py`: **4 / 4** focused regressions passed.
- `python tests/chatgpt_isolated.py`: **3 / 3** Chromium isolated-world checks passed.

Focused v2.1.5 regressions:

1. A verified Send click returns success without waiting for user-message / Stop-button DOM.
2. Immediate post-click DOM teardown does not turn a verified Send into a false failure.
3. A visible 927-character auxiliary ProseMirror outside the composer form is ignored in favor
   of the form-local composer.
4. A zero-width-only composer is treated as empty rather than `existing_draft`.

Raw focused results: `docs/v2.1.5-submit-regression.json`.
Raw DOM results: `docs/browser-dom-results-v2.1.5.json`.
Raw isolated-world results: `docs/chatgpt-isolated-results-v2.1.5.json`.

## Partial / unavailable

The broad historical `chatgpt_regression.py` suite was started and its first ten current adapter
checks passed, but the full historical before/after suite exceeds this environment's command
runtime because its old-adapter negative cases intentionally wait through long timeouts. Its
v2.1.5-critical scenarios are separately covered by the focused 4-case suite and the 36-case DOM
suite above.

`browser_smoke.py` could not run because Chromium is managed in this environment and blocked the
local HTTP fixture with `ERR_BLOCKED_BY_ADMINISTRATOR`. The same policy prevents a trustworthy
native unpacked-extension install test.

No authenticated live ChatGPT or Google Meet account is available here. Therefore this report
does not claim live-site end-to-end validation or native OS clipboard validation.
