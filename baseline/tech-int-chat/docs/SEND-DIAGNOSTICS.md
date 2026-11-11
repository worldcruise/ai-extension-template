# Submission diagnostics — v2.1.5

Open DevTools on the ChatGPT tab, enable Info messages, and filter for:

`tech-int-chat 2.1.5`

Diagnostics are metadata-only. They include request/action/stage, character counts, editor kind,
focus state, insertion method and whether Send was clicked. They do **not** contain prompt text,
transcript text, speaker names, page HTML or conversation URLs.

Current stages are pre-submit only plus the single submit boundary:

- `editor_lookup`
- `insertion`
- `send_button`
- `submission`
- `complete`

Common pre-click errors remain actionable: `editor_not_found`, `existing_draft`,
`generation_in_progress`, `insertion_not_accepted`, `prompt_changed`, and
`send_button_not_ready`.

v2.1.5 intentionally does not wait for ChatGPT conversation/generation DOM after Send. A
verified, enabled Send button is clicked once and the adapter returns. Normal route changes after
that click are not treated as cancellation.

If a future live failure occurs, share the final `[tech-int-chat 2.1.5]` record plus what was
visible in the composer immediately before/after the click. Do not include private transcript
text if you do not want to share it.
