import { initCli, runNodeScript } from "./run-cli.js";

initCli();

const urlArgIndex = process.argv.findIndex((a) => a === "--url");
const url =
  (urlArgIndex >= 0 ? process.argv[urlArgIndex + 1] : null) ||
  process.argv[2] ||
  process.env.JOB_URL ||
  "";

if (!url.trim()) {
  console.error('Usage: node scripts/run-linkedin-test.js --url "<linkedin jobs url>"');
  process.exit(1);
}

const env = {
  JOB_URL: url.trim(),
  LINKEDIN_SEARCH_URL_EXACT: "1",
  LINKEDIN_MAX_JOBS: "1",
  KEEP_BROWSER_OPEN_AFTER_SCAN: "1",
  LINKEDIN_PREVIEW_ONLY: "1",
};

console.log("LinkedIn test preview (1 job, browser stays open, no reports).");
console.log(`URL: ${env.JOB_URL}`);
console.log("");

process.exit(runNodeScript("scripts/read-jobs.js", env));
