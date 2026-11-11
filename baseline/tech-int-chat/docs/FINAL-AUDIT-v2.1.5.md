# Final project audit — v2.1.5

## Scope

Full runtime review after the v2.1.4 live console logs. The requested product constraints remain:
no UI redesign, no Meet selector changes, no transcript parser/splitting changes, no blocking
runtime alerts, and no unrelated refactor without a demonstrated reason.

## Root cause from the live logs

The v2.1.4 records repeatedly showed `clicked:true` with the adapter already in its
`acknowledgment` stage. The composer had typically fallen to one residual character while Send
was no longer present. That means the extension had crossed the Send side-effect boundary but
continued to wait on ChatGPT-specific conversation/generation DOM. ChatGPT route/loading events
could also abort the request. These false failures encouraged retries; later records showed two
editor candidates and an unrelated/leftover 927-character ProseMirror classified as an existing
draft.

## Corrected in v2.1.5

| Area | Result |
|---|---|
| Exact payload + clipboard | Preserved; one frozen string is copied then sent. |
| Pre-click insert verification | Preserved. |
| Send selection | Preserved, including form-local `button[type=submit]`. |
| Post-click DOM acknowledgment | Removed. A verified single Send click is terminal. |
| Navigation cancellation | Removed for `tabs.onUpdated` and ChatGPT `pagehide`; tab close still cancels. |
| Multiple editable candidates | Broad candidates must be inside a form; conversation-turn editors are excluded. |
| Empty placeholder | Zero-width characters are removed during comparison. |
| Existing real draft | Still protected; extension does not overwrite it. |
| Generation already active | Still protected; extension does not click Stop. |
| Duplicate / transport retry | Durable request ID/fingerprint protection remains. |
| Runtime alerts | None. Clear confirmation is deliberately retained. |

## Original refactor-plan audit

- **Transcript correctness:** implemented: source identities, revisions, retry-safe patch IDs,
  stale/out-of-order rejection, resegmentation removal.
- **MV3/service-worker state:** implemented: IndexedDB-backed transcript/job state; service-worker
  restart recovery classification.
- **Capture performance:** implemented: MutationObserver capture + 10-second recovery check; old
  450 ms polling removed; local raw/pending buffers are bounded.
- **Storage/memory:** implemented: 128-row IndexedDB chunks, paged reads, 100k-row / 32M-character
  safety limits, bounded job and diagnostics histories.
- **Panel performance:** implemented: incremental patch rendering and reconnecting paged snapshots.
- **ChatGPT reliability:** implemented: immutable prepared payload, insert verification, composer
  draft/generation safeguards, exactly-once Send boundary, durable dedupe. v2.1.5 removes the
  overcomplicated post-click monitoring that caused the reported degradation.
- **Clipboard:** implemented: copy the exact final outgoing string before ChatGPT work, local
  write first with offscreen fallback; copy failure is non-blocking.
- **UI / selectors:** preservation checks pass; original product surface is unchanged.

## Remaining risks / deliberate limits

ChatGPT and Meet are third-party web apps and can change DOM behavior. The adapter therefore
still relies on public DOM characteristics rather than a supported automation API. v2.1.5 keeps
that surface small and logs metadata-only diagnostics. A real unsent ChatGPT draft deliberately
blocks extension insertion to avoid destroying user text.

No authenticated live-site or native installed-extension E2E run was possible in this managed
browser environment. Optional future work remains in `docs/BACKLOG.md` and was not mixed into
this targeted bug-fix release.
