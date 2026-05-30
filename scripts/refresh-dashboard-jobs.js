import { ensureOllamaRunning, initCli, runNodeScript } from "./run-cli.js";

initCli();

try {
  await ensureOllamaRunning();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

console.log("Refreshing job list from reports/ (Ollama)...");
process.exit(runNodeScript("scripts/preprocess-reports-ollama.js"));
