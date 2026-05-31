# LinkedIn Job Agent
https://www.youtube.com/watch?v=H3KLzcKWj_A
Read-only local Playwright tool for LinkedIn job searches, reports, and a web dashboard.

Works on **Windows, macOS, and Linux**.

## Requirements

- Node.js 18+
- npm
- Playwright Chromium (`npx playwright install chromium`)
- **Google Chrome** recommended for LinkedIn login (Playwright uses the installed Chrome channel by default)
- **[Ollama](https://ollama.com)** for AI summaries when using **Run**, **Run all**, or **Refresh list** (`ollama pull llama3.2:3b`)
- We use llama3.2:3b — you need to download it like this( ollama pull llama3.2:3b) or in Ollama window

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

## Dashboard actions

| Button | Action |
|--------|--------|
| **Run** | one saved search: LinkedIn scrape → Ollama → job list |
| **Run all** | every JSON file in `custom-searches/` |
| **Refresh list** | Ollama only, rebuild list from existing `reports/` |
| **Test** | open 1 job in the browser for preview (no reports) |

The job list at the bottom refreshes automatically when a run finishes. Ollama is started automatically if it is not running yet.

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

On Windows, if a LinkedIn URL contains `&`, use: `$env:JOB_URL="<url>"; npm run read`

Optional model: `OLLAMA_MODEL=qwen2.5:7b npm start`

## Rules

- Read-only on LinkedIn (no Apply / Save / Message).
- Stop on login wall, CAPTCHA, or security prompts.

See `README_HOW_TO_RUN.md` for a step-by-step guide.
