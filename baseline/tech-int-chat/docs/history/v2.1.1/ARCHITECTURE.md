# Implemented runtime design

`background.js` is a module service worker. It registers Chrome listeners at module evaluation,
then initializes one storage/session state lazily when an event needs it. Initialization failures
are reported and can be retried rather than permanently poisoning the startup promise.

```text
Meet DOM (original selectors and parser)
    |
caption / structural MutationObservers + slow health check
    |
meeting.js: complete raw-caption revision groups
    | stable patch ID, epoch, one in-flight batch, matching-revision ACK
    v
background.js -> SessionManager -> TranscriptService serial queue
                                      |
                               TranscriptStore reducer
                                      |
                               StorageService transaction
                         chunks + row lookup + caption revisions + meta
                                      |
                       commit, then ACK and live row/removal delta
                                      |
                                      v
                     popup.js: original UI, indexed incremental rows
                                      |
                              selected stable row IDs
                                      v
background.js -> ChatGPTService -> RequestManager durable receipt
                                      |
                           persist dispatch intent before send
                                      v
                        chatGPT.js: assemble exact final prompt
                                      |
                         COPY_CHATGPT_PAYLOAD -> background.js
                                      |
                   ClipboardService -> focused extension panel
                                      |  native writeText result
                                      |  failure/unavailable, deadline remains
                                      v
                             offscreen/clipboard.html
                                      |  plain-text legacy copy; clear/close helper
                                      v
                             retain clipboard outcome
                                      |
                  ChatGPTAdapter -> composer (also on copy failure)
                                      |
                   click once, observe submission or mark uncertain
```

## Transcript ordering and isolation

A row's namespace combines the Chrome-supplied tab ID, a document-instance ID and the raw
caption ID. Separate sources cannot overwrite each other's records. The UI deliberately
projects all sources into the existing single shared transcript, ordered by assigned sequence
number. This is identity isolation, not a new per-meeting UI filter.

A raw-caption revision owns a complete list of derived split chunks. Updating a raw caption
replaces changed chunks and removes superseded suffixes transactionally. Removing a DOM row
does not remove the recorded transcript. A caption revision record rejects stale/retried
updates, including attempts to revive old removed suffixes.

Clear uses a persisted epoch. It atomically removes transcript chunks/indexes and advances
the epoch. The capture-side local parsed baseline remains, preventing unchanged visible rows
from immediately reappearing. Late packets from older epochs are rejected.

## Storage and bounded work

Persistent payloads are grouped into 128-row chunks. A transaction caches only the chunks it
needs. Only dirty chunks, row indexes, revision metadata and small transcript metadata are
written. An acknowledged patch has committed. Initial snapshots stream in pages, serialized
against patch/clear operations; normal updates do not transfer the full history.

The panel still holds its loaded rows and corresponding DOM. This is intentionally not a
virtualized renderer. See README for safety limits and retention changes.

## Submission guarantees and limits

The worker stores job identity, fingerprint, destination, phase and outcome, but not prompt
payloads in job receipts. An in-flight or retained completed request with the same identity
returns the existing outcome. Coalesced double-click identities have durable aliases so a
lost acknowledgment cannot become a new send once the short coalescing window expires.

The content script separately caches recent in-flight/completed requests. It does not stop an
ongoing generation, overwrite an existing draft, or retry a send-button click. After an
ambiguous transport/DOM failure the outcome is **uncertain**, not 'safe to retry'. Worker
recovery preserves that distinction. These are bounded best-effort safeguards, not permanent
exactly-once delivery to an external website.

## Clipboard boundary (2.1.1)

The clipboard bridge is independent of transcript storage and runs before database
initialization. It accepts only this extension's top-frame content script on the two existing
ChatGPT origins, using Chrome-provided sender metadata. The worker ignores both targeted
clipboard messages so it cannot race the actual recipient's response.

Only a focused extension page attempts the modern API; its result is awaited. If the API is
absent, that page has synchronous legacy handling. No focused receiver or an explicit failure
allows offscreen fallback while the deadline remains. Only same-extension, non-tab contexts
can invoke either writer; optional sender URL metadata is validated as an extension URL.
The legacy helper requires a copy event containing the exact text plus a true command result.
No prompt/selector/composer-builder changes are involved.

Copying and offscreen creation/closing share a serial queue. Expired operations are rejected
before dispatch; input size and queue depth are bounded. A native clipboard write already
handed to the browser cannot be cancelled, so an expired panel attempt is not raced by an
offscreen attempt. Temporary DOM text/listeners are removed after use. Only outcome metadata
is added to durable job receipts. Copy failure is non-fatal and is surfaced through the
existing alert mechanism instead of being silently discarded. No new permission, history
database, UI layout or clipboard-read capability is added in this release.
