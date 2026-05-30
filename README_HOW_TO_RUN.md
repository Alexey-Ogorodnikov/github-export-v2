# How to run (Windows, macOS, Linux)

Most work happens in the **dashboard** (menu buttons). The command line is for setup, LinkedIn login, and occasional tasks.

## Requirements

- Node.js 18+
- npm
- `npx playwright install chromium`
- **Google Chrome** (recommended for LinkedIn login)
- For AI summaries: [Ollama](https://ollama.com) + `ollama pull llama3.2:3b`

`npm run check` verifies Node, Playwright, and folders. Ollama is checked on the first **Run** / **Refresh** (if it is not running, the app starts it).

## Install

```bash
cd linkedin-job-agent
npm install
npx playwright install chromium
npm run check
npm run login
```

Log in to LinkedIn with **email + password** in the opened Chrome window (avoid “Continue with Google” if it is blocked). The session is stored in `browser-profile/`.

## Dashboard

```bash
npm start
```

Opens http://localhost:8080/ (or another port from the console if 8080 is busy).

Same as `npm start`: `npm run dashboard:open`. Server only, no auto-open browser: `npm run dashboard`.

### Saved searches

Searches are JSON files in `custom-searches/`. Example: `example-software-engineer-remote-7d.json`. Add new searches from the dashboard menu.

### Menu buttons (Show menu)

| Button | Action |
|--------|--------|
| **Run** | one selected search: LinkedIn → Ollama → job list |
| **Run all** | every file in `custom-searches/` in sequence |
| **Refresh list** | Ollama only, using existing `reports/` |
| **Test** | preview 1 job in the browser (no reports) |

When a run finishes, the job list at the bottom refreshes automatically.

## CLI (occasional)

| Command | When |
|---------|------|
| `npm run login` | LinkedIn session expired |
| `npm run read -- "<url>"` | one URL → `reports/` only (no Ollama, no dashboard) |
| `npm run preprocess:rebuild` | full rebuild of the job list from all `reports/` |
| `npm run dashboard` | server without auto-opening the browser |

On Windows, if the URL contains `&`:

```powershell
$env:JOB_URL="<linkedin search url>"; npm run read
```

`npm run today` and `npm run live` were **removed** — use the dashboard instead.

## Ollama

Default model: `llama3.2:3b`. To use another model:

```bash
OLLAMA_MODEL=qwen2.5:7b npm start
```

PowerShell:

```powershell
$env:OLLAMA_MODEL="qwen2.5:7b"; npm start
```
