# ChatGPT + Resume Studio sidebar — design source

## Run
Extract the ZIP and open `source/index.html` in a browser. No build step is required. Icons load from a pinned Lucide CDN script; the other UI interactions do not depend on the icon library.

`combined-sidebar-preview.html` is the standalone export of the conversation preview.

## Files
- `source/index.html`: sidebar markup
- `source/styles.css`: scoped layout, colors, and responsive styles
- `source/dock.js`: local interactions, source-chat switching, and sample queue processing

## Included
- Chat and Resume Studio views in one sidebar
- Review Job and Review resume tabs
- Candidate-specific sample queues and immutable request snapshots
- Job reading and previous/next tab controls as local simulations
- Resume template and prompt template dropdowns stacked vertically, with a matching preview on the right
- Continuous sample generation queue, pause/resume, cancellation, and save retry
- Review action opening each result's associated simulated chat
- Saved JSON preview and copy action

## Important boundaries
This is the code for the visual design, not a production Chrome extension or an embedded live ChatGPT session. ChatGPT generation, sign-in, browser tab capture, profile-file parsing, PDF/DOCX export, and opening real conversation URLs require integration. Queue/history/storage use in-memory arrays and Maps; they reset on reload. The six-field validator is only a prototype check and must be replaced with Application Tracker's shared strict parser and validators before real outputs are accepted.

## Extension integration
Use the markup, scoped CSS, and event behavior as the UI reference. Remove the outer preview canvas/browser frame when mounting it inside your existing sidebar. Bundle icons locally for extension use instead of retaining the CDN script. Connect generation, storage, conversation navigation, and tab capture through adapters in the existing extension. Keep candidate, job, prompt, and source-conversation references attached to each request.
