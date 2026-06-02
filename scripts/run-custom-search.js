import {
  getProjectRoot,
  initCli,
  loadCustomSearch,
  parseCliFlags,
  runNodeScript,
  sessionStartMs,
} from "./run-cli.js";
import {
  commitScrapeStats,
  persistScenarioRunStats,
  resolveScenarioIdFromEnv,
} from "./scenario-run-stats.js";

initCli();

const opts = parseCliFlags(process.argv);

let url = opts.url?.trim() || "";
let name = "Custom URL";

if (!url && opts.searchId) {
  const loaded = loadCustomSearch(opts.searchId);
  url = loaded.url;
  name = loaded.name;
}

if (!url) {
  console.error("Usage: node scripts/run-custom-search.js --search-id <id>");
  console.error("   or: node scripts/run-custom-search.js --url \"<linkedin jobs url>\" [--live] [--preprocess-only]");
  process.exit(1);
}

console.log(`Custom search: ${name}`);
console.log(`URL: ${url}`);
console.log("");

const scenarioId = opts.searchId || resolveScenarioIdFromEnv();

const env = {
  ...process.env,
  LINKEDIN_SEARCH_URL_EXACT: "1",
  JOB_URL: url,
};
delete env.LINKEDIN_JOB_POSTED_DAYS;

if (scenarioId && !scenarioId.startsWith("custom-")) {
  env.DASHBOARD_SCENARIO_ID = scenarioId;
}

if (opts.live) {
  env.PREPROCESS_SESSION_START_MS = sessionStartMs();
}

console.log("Scraping LinkedIn jobs...");
let code = runNodeScript("scripts/read-jobs.js", env);
if (code !== 0) {
  console.error(`LinkedIn scrape failed (exit ${code}). See reports/run.log`);
  process.exit(code);
}

if (scenarioId) {
  commitScrapeStats(getProjectRoot(), scenarioId);
}

if (!opts.live) {
  console.log("");
  console.log("Done. Reports saved to reports/");
  process.exit(0);
}

if (opts.preprocessOnly) {
  env.DASHBOARD_SKIP_SERVE = "1";
}

console.log("");
console.log("live: Ollama preprocess + dashboard...");
const liveCode = runNodeScript("scripts/live-dashboard.js", env);
if (liveCode === 0 && scenarioId) {
  persistScenarioRunStats(getProjectRoot(), scenarioId);
}
process.exit(liveCode);
