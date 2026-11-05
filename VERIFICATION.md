# Verification

Verified on November 5, 2026.

## Passed

`node --test tests/controller.test.mjs`: **20 passed, 0 failed**.

The tests cover verified/canceled/failed sign-in, dynamic models and effort support, separate prompt/input payloads, stale-response rejection, cancellation, session expiry, sign-out (including failure), fixed/hidden fields, validation, provider failures, structured API results, and teardown.

`node scripts/build-preview.mjs`: standalone preview generated successfully. JavaScript syntax checks and static standalone dependency checks pass.

## Not verified

The optional Playwright browser suite could not run because this environment has no installed Chromium executable. The available remote browser could not open the local preview within its access rules. Responsive layout, visual appearance, clipboard access, and full browser interaction therefore remain unverified here. The included `tests/browser.test.mjs` checks these flows at widths from 320px to 1440px when Playwright/Chromium are available.

No live ChatGPT login, OAuth callback, model discovery, or inference was tested. The current hosted agent and extension source were not included among the attachments. The supplied preview intentionally uses sample data and performs no network requests.

## Manual acceptance

1. Open `preview.html` in a current Chrome/Edge browser.
2. Confirm Sign in is at the top left, with only Model and Thinking effort on the right.
3. Choose Preview sign in. Confirm the account name appears and the shared status row changes to success.
4. Select a sample model and effort, edit prompt/input, and choose Go. Confirm the sample result appears.
5. Edit an input while running; confirm the old test is canceled and its late result never appears.
6. Select the standard sample model; confirm effort becomes unavailable.
7. Use Settings to make populated fields fixed or hidden, then apply. Confirm these fields retain their values.
8. Confirm status messages appear only beneath the tabs and pair readable text with a light and background color.
9. Test a narrow window, keyboard navigation, Copy result, dark appearance, and sign-out.
10. After integration, repeat with the actual agent's verified session, supported models, expiry, connection failures, and real result contract.
