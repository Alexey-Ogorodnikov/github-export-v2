import fs from "node:fs";
import path from "node:path";
import { getProjectRoot, initCli, parseCliFlags, runNodeScript, sessionStartMs } from "./run-cli.js";

initCli();

const opts = parseCliFlags(process.argv);
const sessionStart = Date.now();
process.env.PREPROCESS_SESSION_START_MS = sessionStartMs();

console.log("today: collecting LinkedIn reports...");
let code = runNodeScript("scripts/run-today.js");
if (code !== 0) {
  process.exit(code);
}

const reportsDir = path.join(getProjectRoot(), "reports");
const newRawFiles = fs.existsSync(reportsDir)
  ? fs
      .readdirSync(reportsDir)
      .filter((name) => name.endsWith("-raw.md"))
      .map((name) => {
        const fullPath = path.join(reportsDir, name);
        return { name, mtime: fs.statSync(fullPath).mtimeMs };
      })
      .filter((entry) => entry.mtime >= sessionStart)
  : [];

console.log(`today: created ${newRawFiles.length} new *-raw.md report(s).`);
for (const file of newRawFiles) {
  console.log(`  - ${file.name}`);
}

const liveEnv = {};
if (opts.preprocessOnly) {
  liveEnv.DASHBOARD_SKIP_SERVE = "1";
}

console.log("live: Ollama preprocess + dashboard...");
process.exit(runNodeScript("scripts/live-dashboard.js", liveEnv));
