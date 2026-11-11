# Changelog

## Unreleased

## 0.6.2 — 2026-11-11

- Request one fenced JSON code panel and three output checks. Capture ChatGPT's current turn/search layouts and CodeMirror code panels, exclude thinking and later turns, and wait for streaming to end plus ready Send or final-reply controls. Validate the complete code block, job/run IDs, schema and candidate facts before review. Preserve capture diagnostics alongside submission diagnostics and keep Resume observe-only after sending.

## 0.6.1 — 2026-11-11

- Verify ChatGPT prompt content using document structure, keep checks bound to the edited composer, and preserve matching content across editor replacement. Reuse an already-prepared prompt on Resume. Distinguish missing editors, mismatched text, and unstable content; retain bounded submission diagnostics in job Details, with a Copy diagnostics action and exact extension/build identity. Add real ProseMirror regression coverage, including blocked submission of changed text.

## 0.6.0 — 2026-11-11

- Add synchronized major/minor/misc (patch) version commands, dated release notes, and build-time consistency checks. Correct the stale lockfile version and derive source build metadata from the manifest.

- Use an already-open ChatGPT tab for Generate, Resume, and Open selected AI. Prefer its active tab, otherwise its most recently used tab; never create or navigate ChatGPT tabs for generation. Replace unsent drafts with native plain text and press Enter once, removing the paste-event path that can create pasted.txt. Allow existing conversation history, serialize jobs sharing a tab, and keep automatic reply capture.

- Replace the partial ChatGPT submission implementation with the full tech-int-chat v2.1.5 adapter, retaining its editor selection, paste/native-input pipeline, readiness checks, cancellation, and diagnostics. Add the job's persistent intent hook and retain explicit draft replacement. Separate verified submission from reply collection, allow bound ChatGPT replies without a conversation URL, and exclude draft previews from posted-message detection.

- Replace unsent ChatGPT text drafts during document preparation. Use native textarea replacement or rich-editor deletion followed by paste handling and verified native insertion, following the tech-int-chat input approach. Wait for consumed asynchronous pastes to avoid duplicate prompts.

- Fix ChatGPT preparation after editor replacement, recognize additional and form-associated Send controls, and allow Enter for a verified composer when Send is absent. Resume can recover a manually submitted job prompt after preparation failed. Capture the final assistant reply after thinking, bounded before the next user turn.

- Add Generate documents as a separate per-job browser-tab workflow for ChatGPT and DeepSeek. Persist submission intent before sending, confirm the posted user message, collect its assistant reply automatically, and require document review before saving. Bind runs to their tab and browser session; recover by observing the original conversation without resending after a recorded attempt. Keep invalid replies for inspection.

- Retire the old prompt delivery and queue runners, Send to AI / Capture result controls, and automation settings. Keep the dock, local job/profile storage, manual documents, and saved conversations. Adding a job only saves locally; legacy runner records never resume.

- Recover a failed DeepSeek sidebar once the network returns without reloading the extension. Keep Reload available before composer readiness, add a Reconnect action for stalled loads, retire failed message channels, and preserve drafts, sign-in input, active responses, and healthy chats.

- Preserve the loaded chat viewport off-screen while the dock is collapsed instead of removing it from layout. Restore it without replaying an opening animation, and keep the collapsed frame inert and out of keyboard focus.

- Keep ChatGPT's loading notice hidden once the current page is connected, including when its composer is temporarily hidden during dock switches. Preserve input-readiness guards and show actual sign-out independently of composer visibility.

- Skip pinned conversations in both providers' Up/Down history navigation. Down from a new or pinned chat starts at the newest loaded regular conversation; typed native search is unchanged.

- Refresh the selected provider when expanding chat. Report an unavailable DeepSeek composer as loading rather than a sign-in requirement, while preserving the mounted page and drafts.

- Replace the Resume Studio / Chat switcher with a single dock. Matching job and chat headers expand one section at a time, while both provider frames stay mounted. Move candidate profile selection and import into the user menu, which fits the available space.
- Adapt the queue demo and ApplicationTracker_v2.1's compact cards, grouped job form, and job-description-first details. Add company/role search, status filters, listing links, and shared horizontal gutters.
- Save manual conversation links for either ChatGPT or DeepSeek on queued jobs and reopen them from the dock with draft and generation guards. Prompt sending remains manual.
- Add a Documents form for importing or pasting resume JSON and an optional cover letter, validating fixed candidate facts before saving a manually prepared job as Ready.

- Preserve DeepSeek's document and sidebar visibility during chat navigation instead of reloading each conversation; avoid a full-reload fallback.
- Remember the user's explicit cookie-banner choice and reuse the same recognized action on later loads, without selecting consent defaults or replacing custom preferences.

- Recognize DeepSeek's unlabeled top-left sidebar icon and wait for delayed history; navigate approved native history URLs through the extension instead of synthetic link clicks.
- Report history-reading or navigation failures instead of leaving clickable DeepSeek arrows silent.

- Correct DeepSeek history URLs to `/a/chat/s/<id>`, share route validation between the frame and toolbar, and test real session paths so the history arrows recognize existing conversations.

- Selecting a provider opens its Chat view and dismisses the user popup automatically; remove the redundant Open chat button and restore focus to the user icon.

- Fix provider switching origin errors by accepting a DeepSeek-origin MessagePort handshake before dispatching commands; retire old ports after navigation.

- Make history arrows reveal hidden or unmounted provider history briefly, restore the previous sidebar visibility, and retain loaded DeepSeek history after closure.
- Serialize native history reads/navigation and recheck drafts, generation and the current route before clicking a fresh link.

- Restore direct query entry in the toolbar: Enter or the arrow fills the provider's native search input, preserving message drafts and keeping results native.
- Recognize attached shortcut labels, add a verified ChatGPT Ctrl/Cmd+K fallback, and confirm the actual input accepts the query before reporting success.

- Replace the saved-title search field with Search chats, opening each provider's original search UI without reading or filtering its results.

- Add the matching hover/pin toolbar to DeepSeek with native loaded-history search/navigation, text sizing, guarded new chat/reload, and current-chat open-in-tab.
- Authenticate DeepSeek frame messages by source, origin and nonce, bound history snapshots, and preserve manual-only sending.

- Move Chat provider into the polished user-icon popup with provider-aware sign-in and full-height chat panes.
- Make Add/Ctrl+Enter save locally without copying or sending, preserving existing chat drafts.

- Add a saved ChatGPT / DeepSeek chat selector with separate mounted frames, lazy DeepSeek loading, sign-in/tab fallback, and guarded reload.
- Scope DeepSeek embed permissions to its chat host and this extension's subframes.

- Replace candidate/company search suggestions with the current ChatGPT session's saved chat titles and native links, with refresh, keyboard selection and candidate-independent results.
- Keep chat titles in panel memory, validate bounded history messages, and preserve draft, generation and stale-navigation protections when choosing a conversation.
- Add a default-on, saved company/URL duplicate check for Add and Ctrl+Enter, with a visible Already applied status and transactional protection across panels.
- Check the selected candidate's queued jobs and saved results before saving, preserving job URL identities and metadata provenance.
- Verify local job saving, duplicate guards, draft protection, document editing, and cancellation with unit tests and isolated browser fixtures.

## 0.5.0 — 2026-11-08

Manual resume queue, grouped keyword highlights, sidebar shortcuts, and ChatGPT history navigation checkpoint. Automatic sending remains paused. Live ChatGPT account behavior remains unverified.

- Add vertically stacked ChatGPT history arrows beside search, following native history order with disabled newest/new-chat and oldest boundaries.
- Protect drafts and ongoing responses during history navigation, restore native sidebar visibility, and require observed URL changes after a single native link click.

- Use a stronger Red (#ff5252) for its color swatch and job-page keyword highlights, preserving existing Red keyword lists.

- Rename Review resume to Job Queues and add Ctrl+Up/Down view navigation, Ctrl+Left/Right browser-tab navigation, and Ctrl+Enter Add to queue shortcuts in the sidebar and embedded ChatGPT.
- List sidebar shortcuts in Settings, suppress held-key repeats, preserve modal controls and composer drafts, and validate frame shortcut messages through the extension runtime.
- Reserve a separate row for the pinned Chat toolbar so it does not cover iframe content; unpin restores the full chat height and hover controls.

- Request optional HTTP/HTTPS website access directly from Read page, resume the same read after consent, and cancel if its tab changes during the prompt.
- Remove the inline Read page status panel; keep progress in the button and show actual failures in an error dialog.
- Add Yellow, Green, Blue, Red, Purple, Orange, and Custom groups with separate saved keyword lists and simultaneous page highlighting.
- Preserve existing single-color keywords in the matching group, migrate the former Pink preset to Red, and retain exact custom colors.

- Move Chat’s New chat and Reload buttons to the left, and add a saved pin preference to keep the toolbar open.

- Change Read page’s default shortcut to Ctrl+Shift+F (Command+Shift+F on macOS), add Keyboard shortcuts to Settings, and show the actual Chrome binding on the button.

- Replace the Company chats button with a compact search field that expands on focus, supports keyboard selection, and preserves the saved-company scope.

- Add clipboard-only Copy prompt actions on request cards and in Details, with a readonly selection fallback.
- Temporarily pause automatic queue sending in both UI and runner; copying preserves request and delivery state.

- Add JSON candidate-profile import and a downloadable format example.
- Persist profiles, queue snapshots, delivery attempts, captured replies, results, and company chat links locally.
- Add an explicit Start queue action and sequential ChatGPT sidebar submission, coordinated across extension windows.
- Protect unsent drafts and require a persisted send intent before clicking Send.
- Capture only the reply associated with the current delivery; validate resume structure and fixed profile facts.
- Archive confirmed completed invalid/error responses without automatic correction or resend; pause on uncertain delivery.
- Recover an existing result after the sidebar closes without submitting again, and retry failed saves from retained output.
- Keep demonstration results opt-in and excluded from the runner.
- Replace the single account-menu assumption with multiple public UI signals and add a self-contained Check connection dialog with a one-panel confirmation fallback.
- Restore unsent authentication-blocked jobs after a successful connection check; keep signed-out pages and uncertain deliveries blocked.
- Handle rich-text paragraph formatting and modern Send controls without failing an unchanged queued draft.
- Continue a verified unsent draft with its original delivery marker; record dispatch and acknowledgement separately and register company chats during generation.
- Review Multi-AI-Prompt's distributed package and add an optional normal ChatGPT tab connection controlled by the existing Studio queue.
- Preserve personal tabs, save the connection choice, pin each delivery to its connection, and reconnect to the owned tab after sidebar closure.
- Add deterministic host/adapter build fingerprints and bounded redacted phase diagnostics; fail closed on missing or mismatched runtime identity.
- Reacquire connected editors before readback, authorization, and dispatch, preserving unexpected drafts without blind reinsertion.
- Separate composer readiness, authentication evidence, and panel-session confirmation in connection inspection.
- Make reconciliation single-request and regeneration deliberate; preserve history and save-only retries.
- Keep Add available during runs, open recorded conversations from Review, and retain separate Details and completed-failure history.
- Preserve company/title provenance, missing values, and historical labels without guessing their origins.
- Validate with focused unit tests and isolated Chrome checks; live account behavior remains unverified.

## 0.4.0 — 2026-11-08

Job extraction and keyboard shortcut checkpoint. Bulk ChatGPT generation remains planned.

- Add Ctrl+Shift+S (Command+Shift+S on macOS) to open Studio and run the same extraction as Read page.
- Connect Read page to background extraction of Company, Job title, URL, and Job Description.
- Combine JobPosting JSON-LD/microdata, ATS adapters, embedded job JSON, and generic content ranking.
- Preserve edits and source-tab drafts during asynchronous reads; handle delayed and inaccessible pages.
- Add pinned extraction references and a review of the supplied repositories and product documentation.
- Validate extraction with 29 unit tests, 20 Chrome fixture cases, and shortcut delivery to open and freshly opened docks.

## 0.3.0 — 2026-11-08

Checkpoint of the combined ChatGPT and Resume Studio workspace.

- Embed ChatGPT with sign-in handoff, recovery controls, and preserved drafts.
- Add the hidden hover toolbar, downward indicator, company-chat picker, and text-size controls.
- Add Studio job fields for company, job title, URL, and Job Description with per-tab drafts.
- Keep job extraction visible with tailoring off; hide the prompt selector in that mode.
- Use all eight baseline resume thumbnails and collapse resume options by default.
- Keep queue actions fixed in a compact footer with icon controls.
- Add locally saved keyword settings and opt-in highlighting on job web pages only.
- Include the baseline references and replace the earlier agent/OAuth starter with this workspace.

Resume Studio remains a UI preview. Generation, page capture, profile import, and
PDF/DOCX export are not connected. Company-chat links and Studio examples remain
in memory; keyword preferences persist locally.

Versions are aligned across the extension manifest, package metadata, and lockfile.
The annotated Git tag `v0.3.0` identifies this exact checkpoint.
