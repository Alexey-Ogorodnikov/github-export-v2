import { ensureOllamaRunning, initCli, runNodeScript } from "./run-cli.js";

initCli();

try {
  await ensureOllamaRunning();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

console.log("Preprocessing reports with Ollama...");
let code = runNodeScript("scripts/preprocess-reports-ollama.js");
if (code !== 0) {
  process.exit(code);
}

if (process.env.DASHBOARD_SKIP_SERVE === "1") {
  console.log("Dashboard already running - skip npm run dashboard.");
  process.exit(0);
}

console.log("Starting dashboard...");
process.exit(runNodeScript("scripts/serve-dashboard.js"));
