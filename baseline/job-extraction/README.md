# Job extraction references

Curated snapshots retrieved on 2026-11-08 to review job-page extraction approaches.
See [the review and implementation notes](../../docs/job-extraction-review.md).

Each available repository folder contains:

- `reference.json`: upstream URL, immutable commit, branch, license metadata, and selected paths.
- `tree.json`: upstream repository file inventory at that commit.
- `source/`: selected source/documentation files and available license notices.

[index.json](index.json) records all seven supplied repositories, including the
HTTP 404 for `HumbleIgnite/hiring-cafe-scraper`. The `auto-apply` repository did not
declare a license in GitHub's repository metadata; its material is reference-only.

These files are not installed, executed, imported, or included in the extension
build. Runtime extraction is implemented independently under `src/job-*`.
Snapshots can be reproduced with `node scripts/review-extraction-references.mjs`;
existing commit pins are retained rather than silently following upstream changes.
