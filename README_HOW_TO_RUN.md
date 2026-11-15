# How to run (Windows, macOS, Linux)

Most work happens in the **dashboard** (menu buttons). The command line is for setup, LinkedIn login, and occasional tasks.

Searches run on **LinkedIn** and **Indeed Canada**. A saved search is a LinkedIn jobs URL. **Run** repeats it on every site checked in the dashboard.

## Requirements

- Node.js 18+
- npm
- `npx playwright install chromium`
- **Google Chrome** (recommended for LinkedIn login)
- For AI summaries: [Ollama](https://ollama.com) + `ollama pull mistral-nemo:12b`

`npm run check` verifies Node, Playwright, and folders. Ollama is checked on the first **Run** / **Refresh** (if it is not running, the app starts it).

## Install

From the project folder:

```bash
npm install
npx playwright install chromium
npm run check
npm run login
```

Log in to LinkedIn with **email + password** in the opened Chrome window (avoid “Continue with Google” if it is blocked). The session is stored in `browser-profile/`. Indeed Canada uses the same browser window. If Indeed shows a security check, complete it there. Do not click Apply, Save, or Message.

## Dashboard

```bash
npm start
```

Opens http://localhost:8080/ (or another port from the console if 8080 is busy).

Same as `npm start`: `npm run dashboard:open`. Server only, no auto-open browser: `npm run dashboard`.

### Saved searches

Searches are JSON files in `custom-searches/`. Example: `example-software-engineer-remote-7d.json`. Add new searches from the dashboard menu by pasting a LinkedIn jobs URL.

Indeed Canada is built from that search: same keywords, location, and posted-date window. It does not need its own saved URL.

### Settings (before Run)

| Setting | What it does |
|---------|----------------|
| **Search sites** | LinkedIn and/or Indeed Canada. At least one stays selected. Default is both. |
| **Posted within** | 1, 2, or 7 days for every search, on each site. |
| **Max jobs** | How many jobs a full scrape opens per search (1–1000). |
| **Mandatory tags** | Up to 5 words. Every enabled tag must appear in the job text. |
| **Company blacklist** | Hides jobs from companies you add. Starts empty. |

### Menu buttons (Show menu)

| Button | Action |
|--------|--------|
| **Run** | one selected search on the checked sites → Ollama → job list |
| **Run all** | every file in `custom-searches/` in sequence |
| **Refresh list** | Ollama only, using existing `reports/` |
| **Test** | preview 1 job in the browser (no reports) |

When a run finishes, the job list at the bottom refreshes automatically. Each search then shows **Last run**: found, added, skipped, and total cards seen.

## CLI (occasional)

| Command | When |
|---------|------|
| `npm run login` | LinkedIn session expired |
| `npm run read -- "<url>"` | one URL → `reports/` only (no Ollama, no dashboard) |
| `npm run preprocess:rebuild` | full rebuild of the job list from all `reports/` |
| `npm run dashboard` | server without auto-opening the browser |
| `npm test` | unit tests, no browser and no Ollama |
| `npm run test:linkedin` | live LinkedIn preview (needs `npm run login`) |
| `npm run test:sites` | live LinkedIn + Indeed Canada preview |
| `npm run test:sites:full` | live full cycle: scrape, Ollama, dashboard |

On Windows, if the URL contains `&`:

```powershell
$env:JOB_URL="<search url>"; npm run read
```

`npm run today` and `npm run live` were **removed** — use the dashboard instead.

## Ollama

Default model: `mistral-nemo:12b`. To use another model:

```bash
OLLAMA_MODEL=qwen2.5:14b npm start
```

PowerShell:

```powershell
$env:OLLAMA_MODEL="qwen2.5:14b"; npm start
```
