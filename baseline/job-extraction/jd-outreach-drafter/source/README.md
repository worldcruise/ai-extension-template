# JD Outreach Drafter

A Chrome extension that reads the job description on the page you're viewing and uses Claude to draft a
cold email and a LinkedIn connection note for the hiring manager or recruiter, grounded in your own resume.

Bring your own Anthropic API key. No server, no account, no tracking.

<img width="400" height="400" alt="image" src="https://github.com/user-attachments/assets/7305313d-c9f8-4c92-b9f3-6c6ee81504c6" />

<img width="400" height="400" alt="image" src="https://github.com/user-attachments/assets/6c55e7d4-32fc-4205-bc39-c7183a08fd5e" />

<img width="400" height="400" alt="image" src="https://github.com/user-attachments/assets/614bee2d-2e26-4140-9e10-f4a509f4a25a" />

<img width="400" height="400" alt="image" src="https://github.com/user-attachments/assets/9ff43611-9948-413b-b7c1-6c74bcb1ee81" />


## Features

- **Finds the job description automatically** on LinkedIn, Greenhouse, Lever, Ashby, Workday, Indeed,
  Glassdoor, Wellfound, Workable, SmartRecruiters, and Handshake, plus a generic fallback for company career pages.
- **Picks up the hiring team** on LinkedIn and any contact email in the posting.
- **Up to three resume variants** (PDF or text). Claude picks the best fit, or you choose.
- **Your rules, your voice.** Outreach rules and "facts Claude may use" are editable.
- **Email and LinkedIn note together**, with a 300-character counter, one-click copy, and "Open in Gmail".
- **Revise in place** ("shorter hook", "swap bullet 3 for the RAG project").
- **Survives closing the popup.** Drafting runs in the background and the result is waiting when you reopen.

## Install

The extension isn't on the Chrome Web Store yet, so load it from source:

1. Download this repo (**Code → Download ZIP**) and unzip it, or `git clone` it.
2. Open `chrome://extensions` (also works in Edge and Brave) and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder that contains `manifest.json`.
4. On the settings page that opens:
   - paste your API key from [console.anthropic.com](https://console.anthropic.com) (a Claude.ai subscription doesn't include API access)
   - add at least one resume
   - fill in your name and signature
   - click **Save settings**, then **Test key**
5. Pin the extension. Keyboard shortcut: **Alt+Shift+J**.

## Use

1. Open a job posting and click the extension icon.
2. Check the title, company, and description it found. You can edit any of them.
3. Choose **Hiring manager** or **Recruiter**, and optionally add a name and email.
4. Click **Draft email and LinkedIn note**.
5. Copy the results, or open the email in Gmail and attach your resume.

If detection misses, highlight the job description and click **Scan page again**, or right-click the
selection and choose **Draft outreach from selected job description**.

## How detection works

`extractor.js` is injected only when you click the icon (`activeTab`), and tries these in order:

1. Text you've highlighted (over 200 characters)
2. schema.org `JobPosting` JSON-LD embedded in the page
3. Site-specific selectors (the `SITES` list)
4. A fallback that scores page blocks by job-description vocabulary and link density

## Privacy

See [PRIVACY.md](PRIVACY.md). In short: your key, resumes, and settings stay in your browser's extension
storage. Page text and resumes are sent only to `api.anthropic.com`, and only when you click Draft.

## Project layout

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 config |
| `extractor.js` | Job description detection, injected on demand |
| `background.js` | Service worker: Claude API call, prompt, right-click menu |
| `popup.html` / `popup.js` | The drafting UI |
| `options.html` / `options.js` | Settings |
| `defaults.js` | Default rules and model list |
| `styles.css` | Shared styles |

No build step. Edit a file, then click reload on the extension card in `chrome://extensions`.

## Contributing

Site support breaks as job boards change their markup, so selector fixes and new sites are the most
useful contributions. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [Rakshatha Vasudev](https://github.com/rakshathavasudev).

## License

[MIT](LICENSE)
