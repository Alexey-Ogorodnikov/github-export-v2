import {
  getProjectRoot,
  initCli,
  loadCustomSearch,
  parseCliFlags,
  runNodeScript,
} from "./run-cli.js";
import { getJobPostedDays, getSearchSiteIds } from "./dashboard-settings.js";
import { isLinkedInJobsSearchUrl, rewriteLinkedInPostedDays } from "./linkedin-search-url.js";
import { isIndeedJobsSearchUrl, rewriteIndeedPostedDays } from "./indeed-search-url.js";
import { buildEnabledSiteSearchUrls } from "./search-sites.js";
import { openBrowserContext, scanUrlToReports } from "./read-jobs.js";
import {
  commitScrapeStats,
  persistScenarioRunStats,
  resolveScenarioIdFromEnv,
} from "./scenario-run-stats.js";

initCli();

const opts = parseCliFlags(process.argv);

let url = opts.url?.trim() || "";
let name = "Custom URL";
let searchConfig = null;

if (!url && opts.searchId) {
  const loaded = loadCustomSearch(opts.searchId);
  url = loaded.url;
  name = loaded.name;
  searchConfig = loaded.config;
}

if (!url) {
  console.error("Usage: node scripts/run-custom-search.js --search-id <id>");
  console.error("   or: node scripts/run-custom-search.js --url \"<job search url>\" [--live] [--preprocess-only]");
  process.exit(1);
}

const postedDays = getJobPostedDays(getProjectRoot());
const siteIds = getSearchSiteIds(getProjectRoot());
const siteUrls = buildEnabledSiteSearchUrls({
  url,
  keywords: searchConfig?.keywords,
  workType: searchConfig?.workType,
  country: searchConfig?.country,
  city: searchConfig?.city,
  days: postedDays,
  siteIds,
});

const scrapeTargets =
  siteUrls.length > 0
    ? siteUrls
    : [
        {
          siteId: isIndeedJobsSearchUrl(url)
            ? "indeed-ca"
            : isLinkedInJobsSearchUrl(url)
              ? "linkedin"
              : "unknown",
          label: name,
          url: isIndeedJobsSearchUrl(url)
            ? rewriteIndeedPostedDays(url, postedDays)
            : rewriteLinkedInPostedDays(url, postedDays),
        },
      ];

console.log(`Custom search: ${name}`);
console.log(`Sites: ${scrapeTargets.map((item) => item.label).join(", ")}`);
for (const target of scrapeTargets) {
  console.log(`${target.label}: ${target.url}`);
}
console.log("");

const scenarioId = opts.searchId || resolveScenarioIdFromEnv();

function scrapeEnv(targetUrl) {
  const env = {
    ...process.env,
    LINKEDIN_SEARCH_URL_EXACT: "1",
    JOB_URL: targetUrl,
  };
  delete env.LINKEDIN_JOB_POSTED_DAYS;

  if (scenarioId && !scenarioId.startsWith("custom-")) {
    env.DASHBOARD_SCENARIO_ID = scenarioId;
  }
  return env;
}

function applyScrapeEnv(targetUrl) {
  const env = scrapeEnv(targetUrl);
  process.env.LINKEDIN_SEARCH_URL_EXACT = env.LINKEDIN_SEARCH_URL_EXACT;
  process.env.JOB_URL = env.JOB_URL;
  delete process.env.LINKEDIN_JOB_POSTED_DAYS;
  if (env.DASHBOARD_SCENARIO_ID) {
    process.env.DASHBOARD_SCENARIO_ID = env.DASHBOARD_SCENARIO_ID;
  }
}

async function scrapeAllTargets() {
  const context = await openBrowserContext();
  let page = context.pages()[0] ?? await context.newPage();
  let failed = 0;
  try {
    for (const target of scrapeTargets) {
      console.log(`Scraping ${target.label}...`);
      applyScrapeEnv(target.url);
      const result = await scanUrlToReports(context, {
        url: target.url,
        page,
        previewOnly: false,
      });
      if (result.exitCode !== 0) {
        console.error(`${target.label} scrape failed (exit ${result.exitCode}). Continuing with other sites.`);
        failed += 1;
      }
    }
  } finally {
    await context.close().catch(() => {});
  }
  if (failed === scrapeTargets.length) {
    process.exit(2);
  }
}

await scrapeAllTargets();

if (scenarioId) {
  commitScrapeStats(getProjectRoot(), scenarioId);
}

if (!opts.live) {
  console.log("");
  console.log("Done. Reports saved to reports/");
  process.exit(0);
}

const liveEnv = scrapeEnv(scrapeTargets[0].url);
if (opts.preprocessOnly) {
  liveEnv.DASHBOARD_SKIP_SERVE = "1";
}

console.log("");
console.log("live: Ollama preprocess + dashboard...");
const liveCode = runNodeScript("scripts/live-dashboard.js", liveEnv);
if (liveCode === 0 && scenarioId) {
  persistScenarioRunStats(getProjectRoot(), scenarioId);
}
process.exit(liveCode);
