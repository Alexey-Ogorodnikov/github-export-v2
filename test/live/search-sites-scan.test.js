/**
 * Live-скан LinkedIn + Indeed Canada через read-jobs.js.
 *
 * Не входит в `npm test` (run-all.js читает только test/*.test.js).
 * Запуск: npm run test:sites
 *
 * Нужны: Google Chrome, сессия `npm run login` в browser-profile/,
 * и чтобы профиль не был занят другим окном дашборда.
 *
 * Сценарии:
 * - Android developer Montreal: LinkedIn и Indeed Canada, по 3 вакансии (preview)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getProjectRoot, loadCustomSearch } from "../../scripts/run-cli.js";
import { openBrowserContext, scanUrlToReports } from "../../scripts/read-jobs.js";
import { buildEnabledSiteSearchUrls } from "../../scripts/search-sites.js";

const LIVE_JOB_COUNT = 3;
const SEARCH_ID = "android-developer-101330853-any-r86400-any-1d";
const SITE_IDS = ["linkedin", "indeed-ca"];

function linkPatternForSite(siteId) {
  if (siteId === "indeed-ca") {
    return /indeed\.com/i;
  }
  return /linkedin\.com\/jobs\/view\/|currentJobId=/i;
}

describe("Search sites live scan", () => {
  it("открывает Android developer Montreal на LinkedIn и Indeed Canada", { timeout: 360_000 }, async () => {
    process.chdir(getProjectRoot());
    const loaded = loadCustomSearch(SEARCH_ID);
    const targets = buildEnabledSiteSearchUrls({
      url: loaded.url,
      keywords: loaded.config?.keywords,
      workType: loaded.config?.workType,
      country: loaded.config?.country,
      city: loaded.config?.city,
      days: loaded.config?.days ?? 1,
      siteIds: SITE_IDS,
    });

    assert.equal(targets.length, 2, "ожидали URL для LinkedIn и Indeed Canada");
    assert.deepEqual(
      targets.map((item) => item.siteId),
      SITE_IDS,
    );

    process.env.LINKEDIN_MAX_JOBS = String(LIVE_JOB_COUNT);
    process.env.LINKEDIN_PREVIEW_ONLY = "1";
    process.env.LINKEDIN_SEARCH_URL_EXACT = "1";
    process.env.LINKEDIN_SKIP_EXISTING = "0";
    delete process.env.KEEP_BROWSER_OPEN_AFTER_SCAN;

    let context = null;
    let page = null;
    const resultsBySite = {};
    try {
      context = await openBrowserContext();
      page = context.pages()[0] ?? await context.newPage();

      for (const target of targets) {
        console.log(`\n=== ${target.label} ===`);
        console.log(target.url);
        const result = await scanUrlToReports(context, {
          url: target.url,
          page,
          previewOnly: true,
        });
        resultsBySite[target.siteId] = result;

        if (target.siteId === "linkedin") {
          assert.notEqual(
            result.exitCode,
            2,
            "LinkedIn показал login/checkpoint. Сначала выполни npm run login.",
          );
        }
        assert.equal(
          result.exitCode,
          0,
          `${target.label}: скан должен завершиться без ошибки (exit ${result.exitCode}). url=${page.url()}`,
        );
        assert.equal(result.reportPaths.length, 0, `${target.label}: preview не пишет reports/`);
        assert.ok(Array.isArray(result.jobs), `${target.label}: scanUrlToReports возвращает jobs`);
        assert.ok(
          result.jobs.length >= 1,
          `${target.label}: не открыли ни одной вакансии. url=${page.url()}`,
        );
        assert.ok(
          result.jobs.length <= LIVE_JOB_COUNT,
          `${target.label}: открыли ${result.jobs.length} вакансий, лимит ${LIVE_JOB_COUNT}`,
        );

        const linkRe = linkPatternForSite(target.siteId);
        for (const [index, job] of result.jobs.entries()) {
          assert.ok(
            String(job.title || "").trim(),
            `${target.label} вакансия ${index + 1}: пустой title`,
          );
          assert.match(
            String(job.link || ""),
            linkRe,
            `${target.label} вакансия ${index + 1} (${job.title}): нет ссылки на вакансию`,
          );
        }
      }

      assert.ok(resultsBySite.linkedin?.jobs?.length >= 1, "LinkedIn не вернул вакансии");
      assert.ok(resultsBySite["indeed-ca"]?.jobs?.length >= 1, "Indeed Canada не вернул вакансии");
    } catch (err) {
      if (page) {
        await page.screenshot({
          path: "reports/search-sites-live-test-fail.png",
          fullPage: true,
        }).catch(() => {});
      }
      throw err;
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
    }
  });
});
