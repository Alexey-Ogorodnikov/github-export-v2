import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchLinkedInContext } from "./browser-launch.js";
import { loadExistingJobKeySet } from "./dashboard-db.js";
import { applyLinkedInPostedDaysFromEnv } from "./linkedin-search-url.js";
import { isIndeedJobsSearchUrl, rewriteIndeedPostedDays } from "./indeed-search-url.js";
import { getMaxJobsPerSearch } from "./dashboard-settings.js";
import { recordScrapeFoundCount } from "./scenario-run-stats.js";

const defaultMinLinkedInJobDelayMs = 1000;
const defaultMaxLinkedInJobDelayMs = 20000;

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
          ? "Preview: job(s) opened for inspection. Browser stays open; no reports saved."
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
  const openUrl = exactUrl
    ? url
    : isIndeedJobsSearchUrl(url)
      ? applyIndeedPostedDaysFromEnv(url)
      : applyLinkedInPostedDaysFromEnv(url);
  const daysEnv = process.env.LINKEDIN_JOB_POSTED_DAYS;
  if (!exactUrl && openUrl !== url && daysEnv) {
    const d = Number.parseFloat(daysEnv);
    if (Number.isFinite(d) && d > 0) {
      console.log(`Date filter: past ${daysEnv} day(s)`);
    }
  }
  // LinkedIn frequently relies on client-side hydration; background tabs may stay "half loaded".
  // Bringing the tab to front before/after navigation makes job cards appear reliably.
  await targetPage.bringToFront().catch(() => {});
  await targetPage.goto(openUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await targetPage.bringToFront().catch(() => {});
  // LinkedIn's current logged-in jobs UI is /jobs/search-results (AI search).
  // Do not rewrite it to /jobs/search/ — LinkedIn bounces back and the new card DOM is missed.

  const currentUrl = targetPage.url();
  const title = await targetPage.title();
  const reportUrl = exactUrl ? url : currentUrl;
  const source = currentUrl.includes("indeed.") || isIndeedJobsSearchUrl(url) ? "indeed" : "linkedin";
  const sourceLabel = source === "indeed" ? "Indeed" : "LinkedIn";
  console.log(`${sourceLabel} page: ${title}`);
  console.log(`${sourceLabel} url: ${currentUrl}`);

  if (source === "linkedin" && isLinkedInAuthBlock(currentUrl, title)) {
    console.log("Stopped: login or security challenge detected.");
    return { exitCode: 2, reportPaths: [], page: targetPage, jobs: [], totalSeen: null, skippedExisting: 0 };
  }

  if (source === "indeed" && await isIndeedSecurityBlock(targetPage)) {
    console.log("Stopped: Indeed security check detected.");
    return { exitCode: 2, reportPaths: [], page: targetPage, jobs: [], totalSeen: null, skippedExisting: 0 };
  }

  let jobs;
  let totalSeen = null;
  let skippedExisting = 0;
  if (source === "indeed") {
    const indeedResult = await readIndeed(targetPage);
    jobs = indeedResult.jobs;
    totalSeen = indeedResult.totalSeen;
    skippedExisting = indeedResult.skippedExisting;
  } else {
    const linkedInResult = await readLinkedIn(targetPage);
    jobs = linkedInResult.jobs;
    totalSeen = linkedInResult.totalSeen;
    skippedExisting = linkedInResult.skippedExisting;
  }

  if (jobs.length === 0 && source === "linkedin") {
    const bodyText = sourceText(await targetPage.locator("body").innerText({ timeout: 3000 }).catch(() => "")).slice(0, 400);
    if (isLinkedInAuthBlock(targetPage.url(), await targetPage.title().catch(() => ""), bodyText)) {
      console.log("Stopped: login or security challenge detected.");
      return { exitCode: 2, reportPaths: [], page: targetPage, jobs: [], totalSeen, skippedExisting };
    }
  }

  if (jobs.length === 0 && source === "indeed" && await isIndeedSecurityBlock(targetPage)) {
    console.log("Stopped: Indeed security check detected.");
    return { exitCode: 2, reportPaths: [], page: targetPage, jobs: [], totalSeen, skippedExisting };
  }

  if (isPreview) {
    console.log(`Preview: opened ${jobs.length} job(s) on ${source}. No reports written.`);
    return { exitCode: 0, reportPaths: [], page: targetPage, jobs, totalSeen, skippedExisting };
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

  return { exitCode: 0, reportPaths: [fileName, linksFileName], page: targetPage, jobs, totalSeen, skippedExisting };
}

export async function keepBrowserOpen() {
  await new Promise(() => {});
}

function linkedInJobCardsLocator(page) {
  return page.locator(LINKEDIN_CARD_SELECTORS.join(", "));
}

const LINKEDIN_CARD_SELECTORS = [
  "[data-occludable-job-id]",
  'div[componentkey^="job-card-component-ref-"]:not(:has(div[componentkey^="job-card-component-ref-"]))',
  'div[role="button"][componentkey^="job-card"]',
  ".job-card-container",
  ".jobs-search-results__list-item",
  ".scaffold-layout__list-item",
  "li.discovery-templates-entity-item",
  ".job-search-card",
  ".base-card",
  "[data-job-id]",
  "li:has(a[href*='/jobs/view/'])",
];

async function resolveLinkedInJobCards(page) {
  for (const selector of LINKEDIN_CARD_SELECTORS) {
    const cards = page.locator(selector);
    if (await cards.count().catch(() => 0) > 0) {
      return cards;
    }
  }
  return linkedInJobCardsLocator(page);
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

function isLinkedInPreview() {
  return process.env.LINKEDIN_PREVIEW_ONLY === "1";
}

/** Preview/test: open up to LINKEDIN_MAX_JOBS cards on the first page — no pagination, no reports. */
async function readLinkedInPreview(page) {
  const maxJobs = resolveMaxJobsPerSearch();
  const delays = resolveLinkedInJobDelays();
  const jobs = [];

  await page.waitForLoadState("domcontentloaded");
  await page.bringToFront().catch(() => {});
  const cards = await waitForLinkedInJobCards(page, 60000);

  const totalCards = await cards.count();
  if (totalCards === 0) {
    await logLinkedInEmptyResults(page);
    return { jobs: [], totalSeen: 0, skippedExisting: 0 };
  }

  console.log(`LinkedIn preview: ${totalCards} card(s) on page, opening up to ${maxJobs} readable job(s).`);

  for (let i = 0; i < totalCards && jobs.length < maxJobs; i += 1) {
    const card = cards.nth(i);
    await card.scrollIntoViewIfNeeded().catch(() => {});
    const summary = sourceText(await card.innerText({ timeout: 5000 }).catch(() => ""));
    if (!summary) continue;

    const title = firstLine(summary);
    console.log(`LinkedIn preview ${jobs.length + 1}/${maxJobs}: ${title}`);

    await card.click({ timeout: 5000 }).catch(() => {});
    await waitWithRandomDelay(page, `preview job ${jobs.length + 1}/${maxJobs}`, delays.min, delays.max);

    const link = (await jobHrefFromCard(card)) || jobViewUrlFromPageUrl(page.url());
    const jobKey = normalizeJobLink(link);
    if (jobKey && jobs.some((job) => normalizeJobLink(job.link) === jobKey)) {
      continue;
    }

    const detail = await readLinkedInDetail(page);
    jobs.push(parseJob(summary, detail, absoluteUrl(link)));
  }

  if (jobs.length === 0) {
    console.log("LinkedIn: no readable job cards found.");
  }

  return { jobs, totalSeen: totalCards, skippedExisting: 0 };
}

async function readLinkedIn(page) {
  if (isLinkedInPreview()) {
    return readLinkedInPreview(page);
  }

  const maxJobsPerSearch = resolveMaxJobsPerSearch();
  const existingJobKeys = resolveExistingJobKeys();
  if (existingJobKeys.size > 0) {
    console.log(`LinkedIn: ${existingJobKeys.size} job(s) already in dashboard, will skip on scan.`);
  }
  const jobs = [];
  const seenJobKeys = new Set();
  let skippedExisting = 0;
  let skippedDuplicate = 0;
  let totalSeen = 0;
  let pageNum = 1;
  const maxPages = Math.ceil(maxJobsPerSearch / 25) + 2;
  const delays = resolveLinkedInJobDelays();

  await page.waitForLoadState("domcontentloaded");
  let cards = await waitForLinkedInJobCards(page, 60000);

  while (pageNum <= maxPages) {
    await page.waitForLoadState("domcontentloaded");
    await page.bringToFront().catch(() => {});
    cards = await waitForLinkedInJobCards(page, 60000);

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

      const link = await jobHrefFromCard(card);
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

      const resolvedLink = link || jobViewUrlFromPageUrl(page.url());
      const resolvedKey = normalizeJobLink(resolvedLink) || jobKey;
      if (resolvedKey && seenJobKeys.has(resolvedKey)) {
        skippedDuplicate += 1;
        console.log(`LinkedIn: skip duplicate on page ${pageNum}: ${title}`);
        continue;
      }
      if (resolvedKey && existingJobKeys.has(resolvedKey)) {
        console.log(`LinkedIn: skip already in list: ${title}`);
        seenJobKeys.add(resolvedKey);
        skippedExisting += 1;
        continue;
      }

      const detail = await readLinkedInDetail(page);
      if (resolvedKey) seenJobKeys.add(resolvedKey);
      jobs.push(parseJob(summary, detail, absoluteUrl(resolvedLink)));
    }

    const moved = await goToNextLinkedInSearchPage(page, seenJobKeys);
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

function isLinkedInAuthBlock(url, title, bodyText = "") {
  return /login|checkpoint|challenge|authwall|signup|session_redirect|captcha|security verification/i
    .test(`${url} ${title} ${bodyText}`);
}

async function isIndeedSecurityBlock(page) {
  const looksBlocked = async () => {
    const url = page.url();
    const title = await page.title().catch(() => "");
    const bodyText = sourceText(
      await page.locator("body").innerText({ timeout: 3000 }).catch(() => ""),
    ).slice(0, 400);
    return /security check|just a moment|__cf_chl|cf-challenge|captcha/i
      .test(`${url} ${title} ${bodyText}`);
  };

  if (!(await looksBlocked())) {
    return false;
  }

  console.log(
    "Indeed: security check. If a captcha is visible, complete it in the Chrome window.",
  );
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const cards = await indeedJobCardsLocator(page).count().catch(() => 0);
    if (cards > 0) {
      return false;
    }
    if (!(await looksBlocked())) {
      return false;
    }
  }
  return true;
}

async function logLinkedInEmptyResults(page) {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const bodyText = sourceText(await page.locator("body").innerText({ timeout: 3000 }).catch(() => "")).slice(0, 400);
  console.log("LinkedIn: no job cards found.");
  console.log(`LinkedIn: url=${url}`);
  console.log(`LinkedIn: title=${title}`);
  if (bodyText) console.log(`LinkedIn: page text: ${bodyText}`);
  if (isLinkedInAuthBlock(url, title, bodyText)) {
    console.log("LinkedIn: page looks like a login/security wall.");
  }
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
    const currentJobId = u.searchParams.get("currentJobId");
    if (currentJobId) return currentJobId;
    const jk = u.searchParams.get("jk");
    if (jk) return jk;
    return u.toString().trim();
  } catch {
    return String(link).trim();
  }
}

async function jobHrefFromCard(card) {
  const href = await card.locator("a[href*='/jobs/view/'], a[href*='currentJobId=']").first()
    .getAttribute("href", { timeout: 2000 }).catch(() => "");
  if (href) return href;

  const selfHref = await card.getAttribute("href").catch(() => "");
  if (selfHref && /jobs\/view|currentJobId=/i.test(selfHref)) return selfHref;

  const jobId = (await card.getAttribute("data-occludable-job-id").catch(() => ""))
    || (await card.getAttribute("data-job-id").catch(() => ""));
  if (jobId && /^\d+$/.test(jobId)) {
    return `https://www.linkedin.com/jobs/view/${jobId}/`;
  }
  return "";
}

function jobViewUrlFromPageUrl(urlString) {
  try {
    const id = new URL(urlString).searchParams.get("currentJobId");
    if (id && /^\d+$/.test(id)) {
      return `https://www.linkedin.com/jobs/view/${id}/`;
    }
  } catch {
    // ignore invalid URLs
  }
  return "";
}

async function goToNextLinkedInSearchPage(page, seenJobKeys) {
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

  const cards = await waitForLinkedInJobCards(page, 30000);
  if (await cards.count() === 0) return false;

  const firstLink = await jobHrefFromCard(cards.first());
  const firstKey = normalizeJobLink(firstLink);
  if (firstKey && seenJobKeys.has(firstKey)) {
    console.log("LinkedIn: next page repeats already seen jobs, stopping.");
    return false;
  }

  return true;
}

async function waitForLinkedInJobCards(page, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const cards = await resolveLinkedInJobCards(page);
    if (await cards.count().catch(() => 0) > 0) return cards;
    await page.waitForTimeout(500);
  }
  return resolveLinkedInJobCards(page);
}

function applyIndeedPostedDaysFromEnv(urlString) {
  const raw = process.env.LINKEDIN_JOB_POSTED_DAYS;
  if (raw === undefined || raw === "") return urlString;
  const days = Number.parseFloat(raw);
  if (!Number.isFinite(days) || days <= 0) return urlString;
  return rewriteIndeedPostedDays(urlString, days);
}

function indeedOriginFromPage(page) {
  try {
    return new URL(page.url()).origin || "https://ca.indeed.com";
  } catch {
    return "https://ca.indeed.com";
  }
}

function indeedJobCardsLocator(page) {
  return page.locator("[data-testid='slider_item'], .job_seen_beacon, [data-jk]");
}

async function waitForIndeedJobCards(page, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cards = indeedJobCardsLocator(page);
    if (await cards.count().catch(() => 0) > 0) return cards;
    await page.waitForTimeout(500);
  }
  return indeedJobCardsLocator(page);
}

async function goToNextIndeedSearchPage(page, seenJobKeys) {
  const next = page.locator(
    'a[data-testid="pagination-page-next"], a[aria-label="Next Page"], a[aria-label="Next"]',
  ).first();
  if (await next.count().catch(() => 0) > 0) {
    const disabled = await next.getAttribute("aria-disabled").catch(() => "");
    if (disabled === "true") {
      return false;
    }
    console.log("Indeed: next page…");
    await next.click({ timeout: 5000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1200);
  } else {
    try {
      const url = new URL(page.url());
      const start = Number.parseInt(url.searchParams.get("start") || "0", 10);
      const nextStart = (Number.isFinite(start) ? start : 0) + 10;
      url.searchParams.set("start", String(nextStart));
      console.log(`Indeed: next page via start=${nextStart}…`);
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1200);
    } catch {
      return false;
    }
  }

  const cards = await waitForIndeedJobCards(page, 15000);
  const firstHref = await cards.first().locator("a[href]").first()
    .getAttribute("href", { timeout: 2000 })
    .catch(() => "");
  const firstKey = jobKeyFromHref(firstHref, indeedOriginFromPage(page));
  if (firstKey && seenJobKeys.has(firstKey)) {
    console.log("Indeed: next page repeats already seen jobs, stopping.");
    return false;
  }
  return (await cards.count().catch(() => 0)) > 0;
}

async function readIndeed(page) {
  const maxJobsPerSearch = resolveMaxJobsPerSearch();
  const existingJobKeys = resolveExistingJobKeys();
  const origin = indeedOriginFromPage(page);
  if (existingJobKeys.size > 0) {
    console.log(`Indeed: ${existingJobKeys.size} job(s) already in dashboard, will skip on scan.`);
  }
  await page.waitForLoadState("domcontentloaded");
  let cards = await waitForIndeedJobCards(page, 30000);
  const jobs = [];
  const seenJobKeys = new Set();
  let skippedExisting = 0;
  let totalSeen = 0;
  let pageNum = 1;

  while (jobs.length < maxJobsPerSearch) {
    const totalCards = await cards.count().catch(() => 0);
    if (totalCards === 0) {
      if (pageNum === 1) console.log("Indeed: no job cards found.");
      break;
    }
    console.log(
      `Indeed: page ${pageNum}, ${totalCards} card(s) on page, `
      + `up to ${maxJobsPerSearch} new to read.`,
    );

    for (let i = 0; i < totalCards && jobs.length < maxJobsPerSearch; i += 1) {
      const card = cards.nth(i);
      const summary = sourceText(await card.innerText({ timeout: 5000 }).catch(() => ""));
      if (!summary) continue;

      const link = await card.locator("a[href]").first().getAttribute("href", { timeout: 2000 }).catch(() => "")
        || await card.getAttribute("href").catch(() => "")
        || "";
      const jobKey = jobKeyFromHref(link, origin);
      const title = firstLine(summary);
      totalSeen += 1;

      if (jobKey && seenJobKeys.has(jobKey)) {
        continue;
      }

      if (jobKey && existingJobKeys.has(jobKey)) {
        console.log(`Indeed: skip already in list: ${title}`);
        seenJobKeys.add(jobKey);
        skippedExisting += 1;
        continue;
      }

      console.log(`Indeed: job ${jobs.length + 1}/${maxJobsPerSearch}: ${title} (page ${pageNum})`);

      await card.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1200);

      const detail = await readIndeedDetail(page);
      if (jobKey) seenJobKeys.add(jobKey);
      jobs.push(parseJob(summary, detail, absoluteUrl(link, origin)));
    }

    if (jobs.length >= maxJobsPerSearch) {
      break;
    }
    const moved = await goToNextIndeedSearchPage(page, seenJobKeys);
    if (!moved) {
      console.log(`Indeed: no more pages (${jobs.length} job(s) read, ${totalSeen} card(s) seen).`);
      break;
    }
    cards = indeedJobCardsLocator(page);
    pageNum += 1;
  }

  if (skippedExisting > 0) {
    console.log(`Indeed: skipped ${skippedExisting} job(s) already in dashboard.`);
  }

  return { jobs, skippedExisting, totalSeen };
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
  const scenarioId = String(process.env.DASHBOARD_SCENARIO_ID || "").trim();
  const lines = [
    "# Raw Job Report",
    "",
    `Source: ${source}`,
    ...emailMetadataLines(emailContext),
    `Page: ${title}`,
    `Search URL: ${currentUrl}`,
  ];
  if (scenarioId && !scenarioId.startsWith("custom-")) {
    lines.push(`Scenario ID: ${scenarioId}`);
  }
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

if (isCliEntryPoint()) {
  await main();
}
