# Job Agent
https://www.youtube.com/watch?v=PFEWtG8lYBk

Read-only local Playwright tool for job searches on **LinkedIn** and **Indeed Canada**, with reports and a web dashboard.

Works on **Windows, macOS, and Linux**.

## Requirements

- Node.js 18+
- npm
- Playwright Chromium (`npx playwright install chromium`)
- **Google Chrome** recommended for LinkedIn login (Playwright uses the installed Chrome channel by default)
- **[Ollama](https://ollama.com)** for AI summaries when using **Run**, **Run all**, or **Refresh list** (`ollama pull mistral-nemo:12b`)
- Default model: `mistral-nemo:12b` — download with `ollama pull mistral-nemo:12b` or from the Ollama app

## Quick start

```bash
npm install
npx playwright install chromium
npm run check
npm run login
npm start
```

Open the URL from the terminal (usually http://localhost:8080/; if the port is busy, the console shows another one).

In the dashboard **Show menu**: add or pick a saved search in `custom-searches/` (there is an example JSON), then use the buttons below.

A saved search is a LinkedIn jobs URL. **Run** executes that search on every site checked under **Search sites** (LinkedIn and Indeed Canada by default). Indeed Canada gets the same keywords, location, and posted-date window.

## Dashboard actions

| Button | Action |
|--------|--------|
| **Run** | one saved search on the selected sites: scrape → Ollama → job list |
| **Run all** | every JSON file in `custom-searches/` |
| **Refresh list** | Ollama only, rebuild list from existing `reports/` |
| **Test** | open 1 job in the browser for preview (no reports) |

The job list at the bottom refreshes automatically when a run finishes. Ollama is started automatically if it is not running yet.

Each saved search shows **Last run** counts after a scrape: found, added, skipped, and total cards seen.

## Settings

| Setting | What it does |
|---------|----------------|
| **Search sites** | LinkedIn and/or Indeed Canada. At least one site stays selected. Each saved search runs on the checked sites. |
| **Posted within** | One window for every search: 1, 2, or 7 days. Applied as the date filter on each site. |
| **Max jobs** | How many jobs a full scrape opens per search (1–1000). |
| **Mandatory tags** | Up to 5 words. A job stays in the list only if every enabled tag appears in its text. |
| **Company blacklist** | Hide jobs from the companies you add. Empty until you add one. |

## CLI (secondary)

| Command | Purpose |
|---------|---------|
| `npm start` | dashboard + open browser |
| `npm run dashboard:open` | same as `npm start` |
| `npm run dashboard` | dashboard server only (no auto-open browser) |
| `npm run login` | manual LinkedIn login (session stored in `browser-profile/`) |
| `npm run read -- "<url>"` | scrape one search URL to `reports/` (no Ollama, no dashboard) |
| `npm run preprocess:rebuild` | full Ollama rebuild of all `reports/` into the job list |
| `npm run check` | verify Node, Playwright, and folders (`reports/`, `browser-profile/`) |
| `npm test` | unit tests (no browser, no Ollama) |
| `npm run test:linkedin` | live LinkedIn preview (needs `npm run login`) |
| `npm run test:sites` | live LinkedIn + Indeed Canada preview |
| `npm run test:sites:full` | live full cycle: scrape, Ollama, dashboard |

On Windows, if a search URL contains `&`, use: `$env:JOB_URL="<url>"; npm run read`

Optional model override: `OLLAMA_MODEL=qwen2.5:14b npm start`

## Rules

- Read-only on LinkedIn and Indeed (no Apply / Save / Message).
- Stop on a login wall, CAPTCHA, or security check. If Indeed shows a check, complete it in the Chrome window.

See `README_HOW_TO_RUN.md` for a step-by-step guide.
