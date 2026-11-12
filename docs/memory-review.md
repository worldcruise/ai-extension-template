# Memory review — 2026-11-12

The reported symptom is approximately 4 GB for Chrome with the extension's window
open, falling to approximately 2 GB after that window closes. This includes the
window's pages and renderers; it does not attribute 2 GB to the extension worker.
The user's signed-in provider pages were not profiled in this review.

## Findings and changes

- **Duplicate AI applications:** ChatGPT previously loaded whenever the dock opened,
  including while browsing the queue. Selecting DeepSeek could load another complete
  application. Both stayed mounted while hidden, alongside generation web tabs.
  Neither embedded provider now loads until chat is expanded. Selecting a prepared
  job remembers its conversation and provider without loading the hidden page.
  Once opened, frames remain mounted to preserve drafts and avoid repeated sign-in
  screens on collapse/expand. Full provider pages remain a likely contributor to
  total window memory; their live footprint was not measured.
- **Growing preview tabs:** Auto preview previously created a new tab per downloaded
  file. A default batch of 25 jobs could therefore open 50 PDF preview tabs.
  Automatic previews now reuse a tab per document kind and format (two slots with
  default PDF settings, up to six across PDF, Word and JSON). Pinned tabs and tabs
  navigating elsewhere are preserved. Every downloaded file remains saved.
- **History allocation churn:** Individual run reads and heartbeat/download updates
  previously materialized the entire generation database with `getAll()`. Keyed
  reads/updates now access one run. Lightweight lists stream summaries without
  retaining all prompts, profile snapshots and replies together. Summary scans
  still traverse history, so listing cost remains proportional to history size.
  Job lookups also use a key instead of reading the entire queue where possible.
- **Repeated refresh work:** Generation notifications now share one in-flight list
  request and a follow-up refresh. Heartbeats no longer trigger full batch advancement.
- **Unnecessary retention:** Closed-tab form drafts are released. A document preview
  retains the metadata needed to open the download rather than keeping its loaded
  byte record as well as the rendered content/blob.

No saved jobs, replies or document files were deleted. IndexedDB document storage
still grows with saved downloads; disk storage is separate from RAM usage.

## Controlled measurements

Chrome fixture test, 200 synthetic historical runs containing approximately 47.7 MiB
of prompt/profile/reply data; ten `generation.read` calls against one run:

| Measurement | Before | After |
| --- | ---: | ---: |
| Ten reads, one controlled run | 526 ms | 41 ms |
| Worker JS heap sampled after reads, before forced GC | 51.33 MiB | 6.18 MiB |
| Worker JS heap after forced GC | 3.57 MiB | 3.55 MiB |
| Embedded provider pages loaded on queue startup | 1 | 0 |

The near-equal retained heap after collection indicates allocation churn in this
test, not a demonstrated steadily retained worker heap leak. These JS heap figures
exclude native renderer memory, PDF viewer processes, GPU allocations and live
provider resources. They do not demonstrate a 2 GB reduction in the user's window.
An additional real-Chrome routing check opened twelve preview files and observed
one preview tab. Concurrent preview routing also has regression coverage.

Artifacts: `artifacts/memory-baseline.json`, `artifacts/memory-current.json`.
Reproduce the current profile with `node tests/chrome.mjs --memory-only`.
`--baseline` names an output file; it does not restore old implementation code.

After reloading the extension and reopening its dock, compare Chrome Task Manager's
Memory footprint rows for the extension worker, extension dock, provider subframes,
AI browser tabs and document previews separately. Existing already-open preview
tabs are preserved; new automatic previews reuse suitable unpinned tabs.
