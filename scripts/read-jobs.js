import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchLinkedInContext } from "./browser-launch.js";
import { loadExistingJobKeySet } from "./dashboard-db.js";
import { applyLinkedInPostedDaysFromEnv } from "./linkedin-search-url.js";
import { getMaxJobsPerSearch } from "./dashboard-settings.js";
import { recordScrapeFoundCount } from "./scenario-run-stats.js";

const defaultMinLinkedInJobDelayMs = 1000;
const defaultMaxLinkedInJobDelayMs = 20000;

if (isCliEntryPoint()) {
  await main();
}

async function main() {
  let context = null;
  try {
    // JOB_URL first: cmd/npm on Windows splits argv on "&" inside LinkedIn URLs.
    const url = (process.env.JOB_URL ?? "").trim() || process.argv.slice(2).join(" ");

    if (!url) {
      console.error('Usage: npm.cmd run read -- "<job search url>"');
      console.error('Or: $env:JOB_URL="<job search url>"; npm.cmd run read');
      process.exit(1);
    }

    console.log(`Opening: ${url}`);

    context = await openBrowserContext();
    const page = context.pages()[0] ?? await context.newPage();
    const previewOnly = process.env.LINKEDIN_PREVIEW_ONLY === "1";
    const result = await scanUrlToReports(context, {
      url,
      page,
      emailContext: getEmailContext(),
      previewOnly,
    });

    if (result.exitCode !== 0) {
      await context.close();
      process.exit(result.exitCode);
    }

    const keepOpen =
      process.env.KEEP_BROWSER_OPEN_AFTER_SCAN === "1" || previewOnly;
    if (keepOpen) {
      console.log(
        previewOnly
          ? "Preview: 1 job opened for inspection. Browser stays open; no reports saved."
          : "Scan complete. Browser and tab are left open. Close the browser or press Ctrl+C when finished.",
      );
      await keepBrowserOpen();
    }

    await context.close();
  } catch (err) {
    if (context) {
      await context.close().catch(() => {});
    }
    console.error(String(err?.stack || err));
    process.exit(1);
  }
}

function resolveProfileDir() {
  const custom = (process.env.LINKEDIN_BROWSER_PROFILE ?? "").trim();
  if (custom) {
    return custom;
  }
  // Тот же профиль, что npm run login и .bat — иначе в «Тест» нет cookies LinkedIn.
  return "browser-profile";
}

export async function openBrowserContext() {
  const profileDir = resolveProfileDir();
  await mkdir(profileDir, { recursive: true });
  await mkdir("reports", { recursive: true });

  return launchLinkedInContext(profileDir);
}

export async function scanUrlToReports(
  context,
  { url, page = null, emailContext = getEmailContext(), previewOnly = false },
) {
  const isPreview = previewOnly || process.env.LINKEDIN_PREVIEW_ONLY === "1";
  const targetPage = page ?? await context.newPage();
  const exactUrl = process.env.LINKEDIN_SEARCH_URL_EXACT === "1";
  const openUrl = exactUrl ? url : applyLinkedInPostedDaysFromEnv(url);
  const daysEnv = process.env.LINKEDIN_JOB_POSTED_DAYS;
  if (!exactUrl && openUrl !== url && daysEnv) {
    const d = Number.parseFloat(daysEnv);
    if (Number.isFinite(d) && d > 0) {
      console.log(`Date filter: past ${daysEnv} day(s) (f_TPR=r${Math.round(d * 86400)})`);
    }
  }
  // LinkedIn frequently relies on client-side hydration; background tabs may stay "half loaded".
  // Bringing the tab to front before/after navigation makes job cards appear reliably.
  await targetPage.bringToFront().catch(() => {});
  await targetPage.goto(openUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await targetPage.bringToFront().catch(() => {});
  // Some LinkedIn links land on /jobs/search-results; that shell uses different markup than /jobs/search/
  // and our card locators see 0 hits. The classic SRP is /jobs/search/.
  await normalizeLinkedInJobsSearchUrl(targetPage);

  const currentUrl = targetPage.url();
  const title = await targetPage.title();
  const reportUrl = exactUrl ? url : currentUrl;

  if (/login|checkpoint|challenge/i.test(currentUrl + " " + title)) {
    console.log("Stopped: login or security challenge detected.");
    return { exitCode: 2, reportPaths: [], page: targetPage };
  }

  const source = currentUrl.includes("indeed.") ? "indeed" : "linkedin";

  let jobs;
  let totalSeen = null;
  let skippedExisting = 0;
  if (source === "indeed") {
    const indeedResult = await readIndeed(targetPage);
    jobs = indeedResult.jobs;
    skippedExisting = indeedResult.skippedExisting;
  } else {
    const linkedInResult = await readLinkedIn(targetPage);
    jobs = linkedInResult.jobs;
    totalSeen = linkedInResult.totalSeen;
    skippedExisting = linkedInResult.skippedExisting;
  }

  if (isPreview) {
    console.log(`Preview: opened ${jobs.length} job(s) on ${source}. No reports written.`);
    return { exitCode: 0, reportPaths: [], page: targetPage };
  }

  const runId = makeRunId();
  const rawReport = buildRawReport({
    title,
    currentUrl: reportUrl,
    source,
    jobs,
    emailContext,
    totalSeen,
    skippedExisting,
  });
  const fileName = `reports/${runId}-raw.md`;
  const linksFileName = `reports/${runId}-links.md`;
  await writeFile(fileName, rawReport, "utf8");
  await writeFile(linksFileName, buildLinksReport({ title, currentUrl: reportUrl, source, jobs, emailContext }), "utf8");

  console.log(`Read ${jobs.length} jobs from ${source}.`);
  console.log(`Raw: ${fileName}`);
  console.log(`Links: ${linksFileName}`);

  recordScrapeFoundCount(process.cwd(), jobs.length, totalSeen, skippedExisting);

  return { exitCode: 0, reportPaths: [fileName, linksFileName], page: targetPage };
}

export async function keepBrowserOpen() {
  await new Promise(() => {});
}

async function normalizeLinkedInJobsSearchUrl(page) {
  let urlString = page.url();
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return;
  }

  if (!/linkedin\.com$/i.test(u.hostname)) return;
  if (!/\/jobs\/search-results\b/i.test(u.pathname)) return;

  u.pathname = "/jobs/search/";
  u.searchParams.delete("skipRedirect");

  const next = u.toString();
  if (next === urlString) return;

  console.log("LinkedIn: redirecting job search from /jobs/search-results to /jobs/search (same query).");
  await page.bringToFront().catch(() => {});
  await page.goto(next, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.bringToFront().catch(() => {});
}

function resolveMaxJobsPerSearch() {
  const raw = process.env.LINKEDIN_MAX_JOBS;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return getMaxJobsPerSearch(process.cwd());
}

function resolveLinkedInJobDelays() {
  if (process.env.LINKEDIN_PREVIEW_ONLY === "1") {
    return { min: 400, max: 1200 };
  }
  return { min: defaultMinLinkedInJobDelayMs, max: defaultMaxLinkedInJobDelayMs };
}

function shouldSkipExistingJobs() {
  const raw = (process.env.LINKEDIN_SKIP_EXISTING ?? process.env.SKIP_EXISTING_JOBS ?? "").trim();
  if (raw === "0" || /^false$/i.test(raw) || /^no$/i.test(raw)) {
    return false;
  }
  return true;
}

function resolveExistingJobKeys() {
  if (!shouldSkipExistingJobs()) {
    return new Set();
  }
  return loadExistingJobKeySet(process.cwd());
}

async function readLinkedIn(page) {
  const maxJobsPerSearch = resolveMaxJobsPerSearch();
  const existingJobKeys = resolveExistingJobKeys();
  if (existingJobKeys.size > 0) {
    console.log(`LinkedIn: ${existingJobKeys.size} job(s) already in dashboard, will skip on scan.`);
  }
  const cards = linkedInJobCardsLocator(page);
  const jobs = [];
  const seenJobKeys = new Set();
  let skippedExisting = 0;
  let skippedDuplicate = 0;
  let totalSeen = 0;
  let pageNum = 1;
  const maxPages = Math.ceil(maxJobsPerSearch / 25) + 2;
  const delays = resolveLinkedInJobDelays();

  await page.waitForLoadState("domcontentloaded");
  await waitForLinkedInJobCards(page, cards, 60000);

  while (pageNum <= maxPages) {
    await page.waitForLoadState("domcontentloaded");
    await page.bringToFront().catch(() => {});
    await waitForLinkedInJobCards(page, cards, 60000);

    const totalCards = await cards.count();
    if (totalCards === 0) {
      if (pageNum === 1) console.log("LinkedIn: no job cards found.");
      break;
    }

    const remaining = Math.max(0, maxJobsPerSearch - jobs.length);
    console.log(
      `LinkedIn: page ${pageNum}, ${totalCards} card(s) on page, `
      + `${jobs.length}/${maxJobsPerSearch} read so far, up to ${remaining} more to read on this page.`,
    );

    for (let i = 0; i < totalCards; i += 1) {
      const card = cards.nth(i);
      await card.scrollIntoViewIfNeeded().catch(() => {});
      const summary = sourceText(await card.innerText({ timeout: 5000 }).catch(() => ""));
      if (!summary) continue;

      totalSeen += 1;

      const link = await card.locator("a[href*='/jobs/view/']").first().getAttribute("href", { timeout: 2000 }).catch(() => "");
      const jobKey = normalizeJobLink(link);
      const title = firstLine(summary);

      if (jobKey && seenJobKeys.has(jobKey)) {
        skippedDuplicate += 1;
        console.log(`LinkedIn: skip duplicate on page ${pageNum}: ${title}`);
        continue;
      }

      if (jobKey && existingJobKeys.has(jobKey)) {
        console.log(`LinkedIn: skip already in list: ${title}`);
        seenJobKeys.add(jobKey);
        skippedExisting += 1;
        continue;
      }

      if (jobs.length >= maxJobsPerSearch) {
        if (jobKey) seenJobKeys.add(jobKey);
        continue;
      }

      console.log(`LinkedIn: job ${jobs.length + 1}/${maxJobsPerSearch}: ${title} (page ${pageNum}, card ${i + 1}/${totalCards})`);

      await card.click({ timeout: 5000 }).catch(() => {});
      await waitWithRandomDelay(
        page,
        `job ${jobs.length + 1}/${maxJobsPerSearch}`,
        delays.min,
        delays.max,
      );

      const detail = await readLinkedInDetail(page);
      if (jobKey) seenJobKeys.add(jobKey);
      jobs.push(parseJob(summary, detail, absoluteUrl(link)));
    }

    const moved = await goToNextLinkedInSearchPage(page, cards, seenJobKeys);
    if (!moved) {
      console.log(`LinkedIn: no more pages (${jobs.length} job(s) read, ${totalSeen} card(s) seen).`);
      break;
    }

    pageNum += 1;
    await page.waitForTimeout(randomInt(1500, 3500));
  }

  if (skippedExisting > 0) {
    console.log(`LinkedIn: skipped ${skippedExisting} job(s) already in dashboard.`);
  }
  if (skippedDuplicate > 0) {
    console.log(`LinkedIn: skipped ${skippedDuplicate} duplicate card(s) on search pages.`);
  }
  if (totalSeen > 0) {
    console.log(
      `LinkedIn: ${totalSeen} vacancy card(s) seen on search `
      + `(${jobs.length} read, ${skippedExisting} already in list, ${skippedDuplicate} duplicate).`,
    );
  }

  return { jobs, totalSeen, skippedExisting };
}

function linkedInJobCardsLocator(page) {
  return page.locator([
    ".job-card-container",
    ".jobs-search-results__list-item",
    ".scaffold-layout__list-item",
    "li:has(a[href*='/jobs/view/'])",
  ].join(", "));
}

function normalizeJobLink(link) {
  return jobKeyFromHref(link);
}

function jobKeyFromHref(link, defaultOrigin = "https://www.linkedin.com") {
  if (!link) return "";
  try {
    const u = new URL(link, defaultOrigin);
    const match = u.pathname.match(/\/jobs\/view\/(\d+)/i);
    if (match) return match[1];
    const jk = u.searchParams.get("jk");
    if (jk) return jk;
    return u.toString().trim();
  } catch {
    return String(link).trim();
  }
}

async function goToNextLinkedInSearchPage(page, cards, seenJobKeys) {
  const urlBefore = page.url();

  const nextButton = page.locator([
    "button.artdeco-pagination__button--next:not([disabled])",
    'button[aria-label="View next page"]:not([disabled])',
  ].join(", ")).first();

  if (await nextButton.count() > 0 && await nextButton.isVisible().catch(() => false)) {
    console.log("LinkedIn: next page…");
    await nextButton.scrollIntoViewIfNeeded().catch(() => {});
    await nextButton.click({ timeout: 8000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1200);
  } else {
    let u;
    try {
      u = new URL(page.url());
    } catch {
      return false;
    }

    if (!u.pathname.includes("/jobs/search")) return false;

    const start = Number.parseInt(u.searchParams.get("start") ?? "0", 10) || 0;
    const nextStart = start + 25;
    u.searchParams.set("start", String(nextStart));
    const nextUrl = u.toString();
    if (nextUrl === urlBefore) return false;

    console.log(`LinkedIn: next page via start=${nextStart}…`);
    await page.goto(nextUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.bringToFront().catch(() => {});
  }

  await waitForLinkedInJobCards(page, cards, 30000);
  if (await cards.count() === 0) return false;

  const firstLink = await cards.first().locator("a[href*='/jobs/view/']").first()
    .getAttribute("href", { timeout: 2000 }).catch(() => "");
  const firstKey = normalizeJobLink(firstLink);
  if (firstKey && seenJobKeys.has(firstKey)) {
    console.log("LinkedIn: next page repeats already seen jobs, stopping.");
    return false;
  }

  return true;
}

async function waitForLinkedInJobCards(page, cards, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const count = await cards.count().catch(() => 0);
    if (count > 0) return;
    await page.waitForTimeout(500);
  }
}

async function readIndeed(page) {
  const maxJobsPerSearch = resolveMaxJobsPerSearch();
  const existingJobKeys = resolveExistingJobKeys();
  if (existingJobKeys.size > 0) {
    console.log(`Indeed: ${existingJobKeys.size} job(s) already in dashboard, will skip on scan.`);
  }
  await page.waitForLoadState("domcontentloaded");
  const cards = page.locator("[data-testid='slider_item'], .job_seen_beacon");
  const totalCards = await cards.count();
  console.log(`Indeed: found ${totalCards} job card(s), up to ${maxJobsPerSearch} new to read.`);
  const jobs = [];
  const seenJobKeys = new Set();
  let skippedExisting = 0;

  for (let i = 0; i < totalCards && jobs.length < maxJobsPerSearch; i += 1) {
    const card = cards.nth(i);
    const summary = sourceText(await card.innerText({ timeout: 5000 }).catch(() => ""));
    if (!summary) continue;

    const link = await card.locator("a[href]").first().getAttribute("href", { timeout: 2000 }).catch(() => "");
    const jobKey = jobKeyFromHref(link, "https://www.indeed.com");
    const title = firstLine(summary);

    if (jobKey && seenJobKeys.has(jobKey)) {
      continue;
    }

    if (jobKey && existingJobKeys.has(jobKey)) {
      console.log(`Indeed: skip already in list: ${title}`);
      seenJobKeys.add(jobKey);
      skippedExisting += 1;
      continue;
    }

    console.log(`Indeed: job ${jobs.length + 1}/${maxJobsPerSearch}: ${title}`);

    await card.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const detail = await readIndeedDetail(page);
    if (jobKey) seenJobKeys.add(jobKey);
    jobs.push(parseJob(summary, detail, absoluteUrl(link, "https://www.indeed.com")));
  }

  if (skippedExisting > 0) {
    console.log(`Indeed: skipped ${skippedExisting} job(s) already in dashboard.`);
  }

  return { jobs, skippedExisting };
}

async function readLinkedInDetail(page) {
  const showMore = page.getByRole("button", { name: "Show more", exact: true });
  if (await showMore.count().catch(() => 0) === 1) {
    await showMore.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  const selectors = [
    ".jobs-description__content",
    ".jobs-box__html-content",
    ".jobs-description-content__text",
    ".jobs-search__job-details--container",
    ".jobs-details",
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;

    const text = sourceText(await locator.first().innerText({ timeout: 5000 }).catch(() => ""));
    if (text.length > 100) return text;
  }

  return "";
}

async function readIndeedDetail(page) {
  const selectors = [
    "#jobDescriptionText",
    "[data-testid='jobsearch-JobComponent-description']",
    ".jobsearch-JobComponent-description",
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;

    const text = sourceText(await locator.first().innerText({ timeout: 5000 }).catch(() => ""));
    if (text.length > 100) return text;
  }

  return "";
}

function parseJob(summary, detail, link = "") {
  return {
    title: firstLine(summary),
    link,
    summary,
    detail,
  };
}

function buildRawReport({ title, currentUrl, source, jobs, emailContext, totalSeen, skippedExisting }) {
  const lines = [
    "# Raw Job Report",
    "",
    `Source: ${source}`,
    ...emailMetadataLines(emailContext),
    `Page: ${title}`,
    `Search URL: ${currentUrl}`,
  ];
  if (Number.isFinite(totalSeen) && totalSeen >= 0) {
    lines.push(`Total seen on search: ${Math.round(totalSeen)}`);
  }
  const skipped = Number(skippedExisting);
  if (Number.isFinite(skipped) && skipped > 0) {
    lines.push(`Skipped existing: ${Math.round(skipped)}`);
  }
  lines.push("", rawJobsSection(jobs), "");
  return lines.join("\n");
}

function rawJobsSection(jobs) {
  if (jobs.length === 0) return "## Jobs\n\nNone.\n";

  return [
    "## Jobs",
    "",
    ...jobs.map((job, index) => [
      `### ${index + 1}. ${job.title}`,
      job.link ? `Link: ${job.link}` : "Link: not found",
      "",
      "Job card text:",
      "```text",
      job.summary,
      "```",
      "",
      "Full description:",
      "```text",
      job.detail || "Description not found.",
      "```",
    ].join("\n")),
    "",
  ].join("\n");
}

function buildLinksReport({ title, currentUrl, source, jobs, emailContext }) {
  return [
    "# Job Links",
    "",
    `Source: ${source}`,
    ...emailMetadataLines(emailContext),
    `Page: ${title}`,
    `Search URL: ${currentUrl}`,
    "",
    ...jobs.map((job, index) => [
      `## ${index + 1}. ${job.title}`,
      "",
      `Link: ${job.link || "not found"}`,
      "",
    ].join("\n")),
  ].join("\n");
}

function makeRunId() {
  const stamp = new Date().toISOString()
    .replace(/:/g, "-")
    .replace(/\..+$/, "")
    .replace("T", "_");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stamp}_${suffix}`;
}

function absoluteUrl(value, defaultOrigin = "https://www.linkedin.com") {
  if (!value) return "";
  try {
    return new URL(value, defaultOrigin).toString();
  } catch {
    return value;
  }
}

function sourceText(value) {
  return value.replace(/\r/g, "").trim();
}

function firstLine(value) {
  return sourceText(value).split("\n").find(Boolean) ?? "Untitled job";
}

function getEmailContext() {
  return {
    index: process.env.JOB_ALERT_EMAIL_INDEX ?? "",
    total: process.env.JOB_ALERT_EMAIL_TOTAL ?? "",
    date: process.env.JOB_ALERT_EMAIL_DATE ?? "",
    received: process.env.JOB_ALERT_EMAIL_RECEIVED ?? "",
    subject: process.env.JOB_ALERT_EMAIL_SUBJECT ?? "",
    sender: process.env.JOB_ALERT_EMAIL_SENDER ?? "",
    id: process.env.JOB_ALERT_EMAIL_ID ?? "",
    sourceFile: process.env.JOB_ALERT_SOURCE_FILE ?? "",
  };
}

function emailMetadataLines(context) {
  if (!context.index || !context.total) return [];

  return [
    `LinkedIn Job Alert Email: ${context.index} of ${context.total}${context.date ? ` for ${context.date}` : ""}`,
    context.subject ? `Email subject: ${context.subject}` : "",
    context.received ? `Email received: ${context.received}` : "",
    context.sender ? `Email sender: ${context.sender}` : "",
    context.id ? `Alert message ID: ${context.id}` : "",
    context.sourceFile ? `Source links file: ${context.sourceFile}` : "",
  ].filter(Boolean);
}

async function waitWithRandomDelay(page, label, minMs, maxMs) {
  const ms = randomInt(minMs, maxMs);
  console.log(`Waiting ${formatSeconds(ms)} before reading ${label}...`);
  await page.waitForTimeout(ms);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function isCliEntryPoint() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    const entry = path.resolve(fileURLToPath(import.meta.url));
    const argvEntry = path.resolve(process.argv[1]);
    return entry === argvEntry;
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}
