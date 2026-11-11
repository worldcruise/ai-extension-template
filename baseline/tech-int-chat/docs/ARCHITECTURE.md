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
                       freeze displayed selected rows + prompt
                                      |
                    shared PromptBuilder -> immutable finalText
                                      |
             local ClipboardWriter (native -> local legacy -> offscreen fallback)
                                      |
                    SEND_CHAT_GPT with finalText and copy receipt
                                      v
background.js -> ChatGPTService -> RequestManager durable receipt
                                      |
                          persist dispatch intent before send
                                      v
                    chatGPT.js: receive prepared finalText
                                      |
                     unchanged ChatGPTAdapter -> composer
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

## Clipboard boundary (2.1.2)

The normal panel path has no background clipboard message: the native API starts before
ChatGPT setup. Selection text is frozen at the click; late caption updates cannot alter it.
The receiver accepts a versioned prepared string and does not rebuild or recopy it. Direct
ChatGPT hotkeys use the shared builder/copy helper from their own initiating key event.

Native rejection tries a local legacy write, with temporary DOM/selection cleanup. Offscreen
is used only after both local paths fail. The service checks same-extension sender identity
and the exact panel URL or top-frame ChatGPT origin before invoking the existing helper.
The worker never competes with the helper's targeted reply. Fallback has its own bounded
expiry; an unresolved native write is not raced by a fallback or another local write.

Only sanitized receipt metadata is stored with jobs, never a second prompt/transcript copy.
Clipboard/submission failures are non-blocking: status/console diagnostics are used instead of runtime alerts. See CLIPBOARD.md for native
promise cancellation limits and the optional native-only diagnostic page.

## Submission adapter boundary (2.1.4)

The prepared payload and existing clipboard path remain unchanged. The ChatGPT controller
passes the same string to the adapter with metadata identifying a panel action or local hotkey.
The adapter locates a writable composer, offers contenteditable text to the page's paste
handler, falls back to native editing only for an unhandled paste into a still-empty composer,
and verifies that the text survives editor reconciliation. It does not rebuild editor HTML.

Send readiness and acknowledgment are separate phases. A single click remains the no-replay
boundary. The adapter reacquires replaced nodes and avoids duplicate synthetic input events.
Bounded metadata traces feed a sanitized durable job diagnostic and non-blocking status/console reporting;
prompt text/DOM snapshots are never included. See SEND-REVIEW.md and SEND-DIAGNOSTICS.md.

### Submit control compatibility (2.1.4)

After insertion is verified, Send discovery first uses named ChatGPT controls and additionally
accepts a plain `button[type="submit"]` only when it is inside the same composer form as the
verified editor. This is the minimal fix for the reproduced v2.1.3 case where text remained in
the composer because no named Send selector matched. The adapter still clicks at most once and
requires post-click acknowledgment; it never retries a side-effecting click.

## Submission boundary correction (2.1.5)

After v2.1.4 live logs showed successful Send clicks being reclassified as failures, the
external side-effect boundary is now explicit: exact insertion and enabled Send are verified
before the click; after one `button.click()` the adapter returns `Content sent` and performs no
conversation/Stop/user-message DOM acknowledgment. Service-worker tab-loading events and
content-script `pagehide` no longer cancel this normal post-submit transition. Broad fallback
editors must be form-local, preventing auxiliary ProseMirror nodes from being treated as the
composer.
