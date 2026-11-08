# Resume Studio extension dock — UI prototype

Open `source/index.html` in a browser to run the editable source directly. No build step is required. Icons load from the Lucide CDN; the dock logic works without them.

`resume-studio-dock.html` is the exported conversation preview.

## Source
- `source/index.html`: dock markup
- `source/styles.css`: appearance and layout
- `source/dock.js`: local interactions and generation queue

## Included
- Review Job and Review resume tabs
- Candidate selection and profile-file selector
- Job-description input and sample previous/next tabs
- Two vertically stacked dropdowns: resume template and prompt template
- Matching template preview to the right
- Sent-job queue, per-job draft selection, cancellation and retry
- Resume editing, copy, and export controls

## Prototype boundaries
Generation uses sample data. ChatGPT sign-in, browser-tab reading, profile parsing, and PDF/DOCX export need real integrations. Queue and edits stay in memory and reset on reload. The queue is not an application-submission history.
