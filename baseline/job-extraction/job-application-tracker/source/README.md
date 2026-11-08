# AppTracker — Job Application Tracker

A self-hosted, privacy-first job application management tool built with **Next.js** and **SQLite**. AppTracker helps you capture, organize, and intelligently score job listings — all stored locally on your machine, with no external database or cloud account required.

It ships as a **web dashboard** you run locally, a **browser extension** (Chrome and Firefox) for one-click job saving from any job board, and an optional **AI layer** powered by either a local Ollama model or an in-browser built-in model.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
  - [1. Clone & Install Dependencies](#1-clone--install-dependencies)
  - [2. Run the Dashboard](#2-run-the-dashboard)
  - [3. Install the Browser Extension](#3-install-the-browser-extension)
    - [Chrome / Chromium](#chrome--chromium)
    - [Firefox](#firefox)
- [Optional Setup](#optional-setup)
  - [AI Features with Ollama (Recommended)](#ai-features-with-ollama-recommended)
  - [Built-in AI Model (No Ollama)](#built-in-ai-model-no-ollama)
  - [Automatic Database Backups](#automatic-database-backups)
- [Feature Guide](#feature-guide)
  - [Dashboard](#dashboard)
  - [Kanban Board](#kanban-board)
  - [Browser Extension](#browser-extension)
  - [Web Scraper](#web-scraper)
  - [Materials](#materials)
  - [AI Match Scoring](#ai-match-scoring)
  - [AI Cleanup](#ai-cleanup)
  - [Activity Calendar](#activity-calendar)
  - [Floating AI Chatbot](#floating-ai-chatbot)
  - [Settings](#settings)
- [Database](#database)
- [Windows Quick-Start](#windows-quick-start)

---

## Features

| Category | Capability |
|---|---|
| **Job Tracking** | Kanban board with stages: Queue → Applied → Interviewing → Offer → Rejected |
| **Browser Extension** | One-click save from LinkedIn, Indeed, YC, Greenhouse, Lever, Ashby, and any whitelisted site |
| **Teach Mode** | Train the extension on new job boards by pointing-and-clicking |
| **Web Scraper** | Playwright-powered headless scraper with configurable target sites and AI-assisted parsing |
| **AI Match Scoring** | Local embedding model (`bge-large-en-v1.5`) scores every job against your résumé / profile |
| **Target Job Goal** | Set a goal description to get a secondary "goal match" score alongside résumé fit |
| **Smart Calibration** | LLM-driven calibration that generates synthetic jobs and maps your true score preferences |
| **AI Resume Suggestions** | Per-job AI suggestions for how to tweak your résumé, powered by Ollama or a built-in model |
| **AI Cleanup** | Bulk AI pass over your tracked jobs to detect and flag stale or irrelevant applications |
| **Materials Library** | Upload PDFs (résumés, cover letters, portfolios) and attach them to job applications |
| **Activity Calendar** | Visual calendar of all application events |
| **Floating Chatbot** | Context-aware sidebar chatbot aware of your current page and job data |
| **Auto Backup** | Scheduled SQLite backups to any folder on your machine, keeping the last 7 versions |
| **Recycle Bin** | Soft-delete with a restore option before permanent deletion |
| **Firefox & Chrome** | Extension ships in two variants — Manifest V3 for both browsers |

---

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Server Actions)
- **Database**: [SQLite](https://www.sqlite.org/) via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) — the file `tracker.db` lives at the project root
- **Embeddings**: [`@xenova/transformers`](https://github.com/xenova/transformers.js) — `Xenova/bge-large-en-v1.5` runs entirely in Node.js (CoreML-accelerated on Apple Silicon)
- **AI / LLM**: [Ollama](https://ollama.com/) (local, optional) or `Xenova/TinyLlama-1.1B-Chat-v1.0` (built-in, offline)
- **Scraping**: [Playwright](https://playwright.dev/) (headless Chromium)
- **UI**: React 19, Lucide React icons, vanilla CSS with glassmorphism design
- **PDF parsing**: `pdf-parse`
- **Language**: TypeScript

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js ≥ 18** | Required. Download from [nodejs.org](https://nodejs.org). |
| **npm ≥ 9** (or yarn/pnpm/bun) | Comes with Node.js |
| **Git** | To clone the repository |
| **~2 GB disk space** | For Node modules, the embedding model, and Playwright's Chromium |
| **Ollama** *(optional)* | For AI resume suggestions and smart calibration |

---

## Installation & Setup

### 1. Clone & Install Dependencies

```bash
git clone <your-repo-url> application-tracker
cd application-tracker
npm install
```

> **Note:** `better-sqlite3` requires a native build step. This runs automatically during `npm install`. If it fails, ensure you have platform build tools installed (Xcode CLI on macOS, `build-essential` on Linux, or Visual Studio Build Tools on Windows).

### 2. Run the Dashboard

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The SQLite database (`tracker.db`) is created automatically on first launch with all required tables.

> **Memory note:** The dev script pre-allocates 16 GB of heap space for Node.js (`NODE_OPTIONS='--max-old-space-size=16384'`). This prevents crashes when the embedding model runs inference. You can lower this value in `package.json` if your system has less RAM.

### 3. Install the Browser Extension

The extension talks to your local dashboard at `http://localhost:3000`. Make sure the dashboard is running before using it.

#### Chrome / Chromium

1. Navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `extension/` folder from the project root
5. The **AppTracker Job Saver** icon will appear in your toolbar

#### Firefox

1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Open the `extension-firefox/` folder and select the `manifest.json` file

> **Persistent install (Firefox):** Temporary add-ons are removed on browser restart. For a persistent install, the extension would need to be signed by Mozilla. During development, use the temporary method above.

---

## Optional Setup

### AI Features with Ollama (Recommended)

Ollama lets you run large language models locally for resume suggestions, smart calibration, and the scraper's AI parsing step.

1. **Install Ollama:** [https://ollama.com/download](https://ollama.com/download)

2. **Pull a model** (DeepSeek R1 is the default):

   ```bash
   ollama pull deepseek-r1
   ```

   Any other Ollama-compatible model works. If your machine has sufficient memory (≥ 32 GB RAM recommended), `deepseek-r1:32b` delivers the best quality results for resume suggestions and calibration. Lighter options for lower-RAM systems:

   ```bash
   ollama pull deepseek-r1:32b # ~20 GB — best quality, high-memory systems
   ollama pull llama3.2        # ~2 GB
   ollama pull mistral         # ~4 GB
   ollama pull phi4-mini       # ~2.5 GB
   ```

3. **Start Ollama** (it typically runs automatically after install):

   ```bash
   ollama serve
   ```

4. In AppTracker, go to **Settings → AI Models**, select **Ollama**, choose your pulled model, and save.

### Built-in AI Model (No Ollama)

If you don't want to install Ollama, AppTracker can run a quantized `TinyLlama-1.1B` model directly in Node.js using `@xenova/transformers`. No additional install is needed — the model is downloaded automatically on first use (~700 MB).

In **Settings → AI Models**, set the provider to **Built-in** and select the model.

> ⚠️ The built-in model is significantly less capable than larger Ollama models and is better suited for basic suggestions rather than nuanced analysis.

### Automatic Database Backups

AppTracker can automatically back up `tracker.db` to any folder you specify:

1. Go to **Settings → System**
2. Set a **Backup Folder** path (e.g., a synced Dropbox or iCloud folder)
3. Save — the app will create a timestamped backup every 12 hours, keeping the last 7 files

You can also trigger a manual backup from the same page, or restore from a previous backup file.

---

## Feature Guide

### Dashboard

The landing page (`/`) provides an at-a-glance overview:

- **Stats cards** — counts for Queue, Applied, Interviewing, and Offers
- **Recent Applications** — last 5 tracked jobs with stage badges and quick-delete
- **Insights panel** — your interview success rate (interviews + offers ÷ applied) and total application count
- **Recycle Bin link** — access soft-deleted jobs before permanent removal

### Kanban Board

Navigate to **Kanban Board** (`/board`) to manage all your tracked applications.

- Jobs are organized into columns: **Queue**, **Applied**, **Interviewing**, **Offer**, **Rejected**
- Click any job card to open the **detail view**, which shows:
  - Job description, company, location, and source URL
  - **AI Match Score** — how well the job matches your uploaded résumé/profile
  - **Goal Match Score** — how well it matches your target job description
  - **AI Resume Suggestions** — actionable bullet points to tailor your résumé for this specific role
  - Notes field for personal comments
  - Application deadline
  - Attached materials (résumés, cover letters)
- Drag cards between columns or use the stage dropdown to move a job
- Use the **filter/sort** controls to search by company, title, or stage

### Browser Extension

The extension adds a **Save to AppTracker** button that injects a save modal directly onto any job listing page.

**Default whitelisted sites:**
- `linkedin.com`
- `indeed.com`
- `ycombinator.com` (HN Who's Hiring)
- `builtin.com`
- `greenhouse.io`
- `lever.co`
- `ashbyhq.com`

**Workflow:**

1. Browse to a job posting on any whitelisted site
2. Click the **AppTracker** extension icon in your toolbar
3. Click **Save Job** — a modal appears on the page with pre-filled job details (title, company, location, description)
4. Review, edit if needed, and confirm to send the job to your tracker

**Adding a new site:**

1. Navigate to any page on the new site
2. Click the extension icon — if the domain isn't whitelisted, you'll see an **Add to Whitelist** button
3. Click it — the page reloads and the extension becomes active on this domain

**Teach Mode (for unsupported layouts):**

If auto-extraction fails on a whitelisted site:

1. Click the extension icon → **Teach Mode**
2. Hover over the job card/listing element on the page — it will highlight
3. Click it — the extension learns the CSS selector for this site's layout and saves it locally
4. Future visits to this site will use the learned selector automatically
5. Click **Forget Layout** in the popup to reset

**Manual Entry:**

Click **Manual Entry** in the popup to open a blank form if you want to add a job without auto-extraction.

### Web Scraper

Navigate to **Scraper** (`/scraper`) to bulk-fetch jobs from configured websites.

- **Target Sites** — configure URLs in Settings → Scraper (defaults: YCombinator, BuiltIn, RemoteOK, Simplify)
- **Focus Filter** — describe the type of role you want (e.g., "ML engineer, Python, remote") so the AI discards irrelevant results before they reach your review queue
- **AI-Assisted Parsing** — Ollama or the built-in model extracts structured job data from raw page HTML
- **Headless mode toggle** — run Chromium in the background (default) or visible (useful for debugging sites with bot protection)
- Scraped results appear in a review queue; accept promising ones to add them to your Kanban board

### Materials

Navigate to **Materials** (`/materials`) to manage your career documents.

- **Upload** PDF files (résumés, cover letters, writing samples, portfolios)
- **Mark as Profile** — designate one or more documents as your profile. These are embedded and used as the baseline for AI match scoring across all jobs
- **Attach to Jobs** — link specific materials to individual job applications from the job detail view
- Materials are stored in `public/uploads/` and their text is embedded using `bge-large-en-v1.5` for vector similarity search

### AI Match Scoring

Every job in AppTracker receives up to two scores:

| Score | Description |
|---|---|
| **Match Score** | Cosine similarity between the job's embedding and your profile materials' average embedding, mapped to 0–100 |
| **Goal Match Score** | Similarity between the job and the **Target Job Goal** text you set in Settings |

**Calibration modes** (configurable in Settings → Calibration):

- **Simple** — linear normalization between a configured min/max similarity range (default: 0.55–0.85)
- **Smart** — LLM generates a set of synthetic jobs at different quality levels, you rate them, and the system fits a piecewise-linear curve to map raw similarity to a score that matches your intuition

### AI Cleanup

Navigate to **AI Cleanup** (`/ai-cleanup`) to run a batch pass over your tracked jobs.

- Analyzes all jobs in your queue against your profile and criteria
- Flags applications that are stale, weak matches, or unlikely to progress
- Presents a review interface where you can accept deletion suggestions or dismiss them
- Helps keep your Kanban board focused and noise-free

### Activity Calendar

Navigate to **Activity** (`/calendar`) for a chronological view of all events:

- Every stage change, new application, and note is logged as an activity
- Browse by month/week to understand your application velocity and identify slow periods

### Floating AI Chatbot

A **chatbot panel** is available on every page (bottom-right corner).

- Context-aware: knows which page you're on and can read your current job list
- Ask questions like:
  - *"Which of my queued jobs have the highest match score?"*
  - *"Summarize the job description for [Company]"*
  - *"What should I prioritize this week?"*
- Powered by your configured AI provider (Ollama or built-in)

### Settings

Navigate to **Settings** (`/settings`) for full configuration:

**Prompts tab:**
- Create, edit, and delete AI prompt templates used for resume suggestions
- Activate a prompt to make it the default for all jobs
- The system default prompt instructs the AI to return 3–5 actionable bullet points

**Calibration tab:**
- Switch between Simple and Smart calibration modes
- Run Smart Calibration: select profile materials, describe your ideal role, and let the LLM generate and score synthetic job listings to build a personalized scoring curve
- View and manually inspect the generated calibration curve

**Scraper tab:**
- Add/remove target scraper websites
- Configure the AI model used for scraping (separate from the resume-suggestion model)
- Toggle headless Chromium mode
- Manage Focus Filters (saved role descriptions for filtering scraper results)

**System tab:**
- **AI Provider** — choose between Ollama (recommended) and Built-in, set model names
- **Database Backup** — configure a backup folder, trigger manual backups, restore from a `.db` file
- **Bulk Cleanup** — configure and start the AI cleanup pass

---

## Database

All data is stored in a single SQLite file: **`tracker.db`** at the project root.

| Table | Description |
|---|---|
| `jobs` | Tracked job applications (title, company, stage, notes, deadline, vector embedding, etc.) |
| `materials` | Uploaded PDF metadata and embeddings |
| `job_materials` | Many-to-many link between jobs and materials |
| `activities` | Event log for the activity calendar |
| `prompts` | AI prompt templates |
| `settings` | Key-value app configuration store |
| `scraped_jobs` | Jobs found by the Playwright scraper (staging queue) |
| `extension_jobs` | Jobs submitted via the browser extension (staging queue) |
| `scraper_logs` | Scraper run history and error log |

> The schema is managed entirely by the app. Tables and columns are created/migrated automatically on startup — you never need to run manual SQL migrations.

---

## Windows Quick-Start

A `scripts/Start Application.bat` launcher is included for Windows users who want a double-click experience:

1. Ensure `node.exe` is present at the script's directory level
2. Double-click **Start Application.bat**
3. The script installs Playwright's Chromium browser on first run, then starts the server and opens `http://localhost:3000` automatically
4. Keep the terminal window open while using the app — closing it stops the server

---

## Development Notes

```bash
# Run in development mode (hot-reload)
npm run dev

# Lint
npm run lint

# Build production bundle
npm run build

# Start production server
npm start
```

The embedding model (`bge-large-en-v1.5`) is downloaded from Hugging Face on first use and cached by `@xenova/transformers`. On Apple Silicon Macs, it uses CoreML for GPU-accelerated inference automatically.
