# Optional improvements retained for future work

These are NOT claims of completed implementation.

## Real-browser acceptance and lifecycle tests

Run the local IndexedDB/background browser fixture, then add an actual unpacked-extension
runner. Exercise real MV3 worker termination/reactivation, reload/update, permission denial,
tab navigation/closure, two windows, two Meet tabs, closed panels, quota failures and Chrome
side-panel behavior. Run live authenticated Meet/ChatGPT checks with explicit user consent.
The delivery environment blocked normal browser navigation/extension loading by policy.

## Long-session performance profiling

Measure mutation callback rate, IndexedDB transaction latency, queued bytes, panel rendering
and heap usage at realistic 1-, 2- and 4-hour transcript volumes. Do not claim CPU/battery
percent improvements without measurements. Explore viewport virtualization only after
preserving scroll anchoring, selection, keyboard shortcuts, export and accessibility behavior.

## Broader automated coverage

The delivered core and offline DOM tests are a starting regression suite. Expand property-based
revision/resegmentation testing, randomized packet delay/loss, crash-at-each-transaction-boundary,
clear/snapshot/submission races and editor-framework compatibility fixtures.

## TypeScript migration

Convert pure modules first; use discriminated unions for protocol messages, caption groups,
job phases, acknowledgment versus uncertainty, and storage schemas. Keep a zero-build/runtime
package available to the user, and preserve the UI/selector checks throughout migration.

## CI / release validation

Add a CI pipeline for syntax, unit tests, preservation hashes, local browser fixtures, actual
extension loading, manifest/file-reference checks and reproducible packaging. Require a release
checksum and explicit test-status report. No hosted CI integration was installed in this build.

## Product decisions requiring approval

Separate per-meeting UI views rather than the existing aggregate panel; durable multi-day
history/retention controls; full virtualization; explicit ChatGPT target selection; migration
from website automation to an authenticated service/API. Do not silently ship these as refactors.
