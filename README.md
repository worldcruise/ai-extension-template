# AI Agent Template

A Chrome Manifest V3 extension with a combined **ChatGPT + Resume Studio** workspace.
Current version: **0.3.0**. See [CHANGELOG.md](CHANGELOG.md) for this checkpoint.
The Chat view embeds ChatGPT using your browser's session. Resume Studio is an
interactive UI preview based on `baseline/combined-chatgpt-resume-studio-code`.

Studio includes Review Job and Review resume views, example candidate selection,
job-description drafts, template/prompt previews, example queue actions, request
details, resume previews, and JSON copy. Its sample data stays in memory and resets
when the panel closes. It does not submit AI requests or persist resumes. Profile
import, page capture, real generation, and PDF/DOCX export are
not connected yet; their controls show their current availability.

ChatGPT stays mounted when switching views, preserving its conversation and composer.
The header holds Resume Studio, Chat, and account controls. New chat, reload, and
open-in-tab actions sit in a toolbar hidden by default. Hover over the top edge
of Chat to slide it down; moving away hides it again. A small downward chevron
marks the hidden controls. Keyboard focus or a tap on the top edge also reveals
them. Hover over or click Company chats on the left to search the selected
candidate's saved companies that have connected conversations. Selecting a
company opens its connected chat. To connect one, open its conversation in Chat,
then use Review → Connect current chat on the saved company in Studio. Links
stay in this panel's memory and reset with the sample workspace; no ChatGPT
account history is read. Chat uses the full remaining panel
height, with no Studio footer. Studio queue actions stay fixed
below the scrolling content. Model and thinking settings are managed inside
ChatGPT. Account controls open the real ChatGPT sign-in page; the Studio examples
do not represent a connected account.

Chat zoom icons sit before New chat and change the font size inside Chat from
50% to 150% in 10% steps, preserving the iframe dimensions and viewport. New
messages and the composer follow the selected text size. Resume template selection
uses all eight original images from `baseline/thumbnails`, bundled locally in
`assets/resume-templates`.
Turning tailoring off keeps the job extraction fields and controls open, hides
the prompt-template dropdown, and uses base-resume instructions. Turning it back
on restores the prompt selection. The description field is labeled Job Description.
Resume options & instructions starts collapsed; click its heading to expand it.

Keyword highlighting applies only to job web pages. Use the Highlight switch
beside the compact tab controls; Read page sits at the far right. Open the user
menu → Settings → Keyword highlights to save keywords (one per line), color,
case matching, and whole-word matching. These preferences stay on this device.
Open the extension from the job page to grant temporary access to that page.
Highlights use CSS text ranges, preserving page markup and editable fields,
and update as job content changes. The dock and ChatGPT are never highlighted.

Previous/Next switches the actual open tabs in the sidebar's associated browser
window, wrapping at either end. The counter updates when tabs open, close, move,
or become active. Company, job title, URL, and JD drafts are retained per tab while
the panel is open. URLs fill from permitted page metadata; manually entered URLs
are retained and included in queued request snapshots. Navigation uses tab IDs and positions and does not request page-content
access; Read page remains unavailable until capture is connected.

Highlight feedback appears in the toggle's hover hint. The fixed footer uses a
compact queue row with icon controls; action messages remain available to screen
readers and as a queue-row hover hint without taking up a separate status row.

## Start

Requires Node.js 24+ to run the checks and build. There are no package dependencies.

```powershell
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this project's `dist/extension` folder.
3. Pin **AI Agent Template**, then click its icon. The shortcut is **Alt+Shift+G**
   on Windows/Linux or **Command+Shift+G** on macOS; customize it at
   `chrome://extensions/shortcuts`.
4. If needed, sign in to ChatGPT in a normal tab, return to the sidebar, and reload.

The toolbar starts a new chat, reloads the current chat, or opens it in a normal
tab. ChatGPT provides its own conversation history, model picker and composer.
The extension does not submit prompts, inspect tokens, or persist conversations.

Run `npm run build` and reload the extension after changing its source. You can
also load the repository root directly during development.

## Project map

| Path | Purpose |
| --- | --- |
| `manifest.json` | Extension permissions, entry points and shortcut |
| `index.html`, `src/sidebar.css`, `src/workspace.mjs` | Combined shell, themes, accessible tabs, and dialogs |
| `src/sidebar.mjs` | Live ChatGPT frame loading/recovery and toolbar controls |
| `src/chat-toolbar.mjs` | Hover toolbar and connected company-chat dropdown |
| `src/company-chats.mjs` | Saved company source links scoped to the selected candidate |
| `src/browser-tabs.mjs` | Window-scoped open-tab navigation and live tab counts |
| `src/keyword-settings.mjs`, `src/keyword-matcher.js` | Local keyword preferences and literal matching |
| `src/page-highlights.mjs`, `src/job-page-highlighter.js` | Opt-in job-page highlighting with temporary page access |
| `src/studio.mjs`, `src/studio-examples.mjs` | Studio interactions and explicitly labeled example data |
| `src/icons.mjs` | Locally bundled SVG icons; no remote script dependencies |
| `src/service-worker.mjs` | Side-panel setup and frame rule registration |
| `src/sidebar-protocol.mjs` | Frame message checks, conversation URLs and embed rule |
| `src/chatgpt-frame.js` | Readiness/navigation signals and sign-in link handoff |
| `scripts/build-extension.mjs` | Packages only runtime files into `dist/extension` |
| `baseline/` | Original reference extensions; excluded from the build |

The frame integration is adapted from the reference sidebar's architecture. Its
header rule removes `X-Frame-Options` and `Content-Security-Policy` for ChatGPT
subframe requests initiated by **this extension only**. Ordinary tabs and frames
on other websites do not match. Keyword preferences use local extension storage.
Job highlighting uses Chrome's [temporary active-tab access](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
and scripting permission. No all-sites host access, backend service, API key,
or OAuth setup is required.

Embedding depends on the ChatGPT website and its current browser/session behavior.
The frame stays visible during slow loading; **Open ChatGPT** and **Try again**
provide recovery without treating a timeout as proof of logout.

## Check

```powershell
npm test
npm run test:browser
```

The browser smoke test checks the combined workspace, candidate isolation, request
snapshots, preview/copy actions, keyboard navigation, narrow layouts, themes, and
preservation of the ChatGPT frame and composer across view changes. It also verifies
the native side panel and connection recovery. It uses an isolated Chrome profile and local fixture pages,
not your real ChatGPT account. Set `CHROME_PATH` if Chrome is not at a standard
installation path. Screenshots and the smoke-test report go to `artifacts/`.
