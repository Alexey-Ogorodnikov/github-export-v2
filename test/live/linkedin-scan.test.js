/**
 * Live-скан LinkedIn через существующий read-jobs.js.
 *
 * Не входит в `npm test` (run-all.js читает только test/*.test.js).
 * Запуск: npm run test:linkedin
 *
 * Нужны: Google Chrome, сессия `npm run login` в browser-profile/,
 * и чтобы профиль не был занят другим окном дашборда.
 *
 * Сценарии:
 * - открывает сохранённый поиск и перебирает 5 вакансий (preview, без reports)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getProjectRoot, loadCustomSearch } from "../../scripts/run-cli.js";
import { openBrowserContext, scanUrlToReports } from "../../scripts/read-jobs.js";

const LIVE_JOB_COUNT = 5;
const SEARCH_ID = "android-developer-101330853-any-r86400-any-1d";

describe("LinkedIn live scan", () => {
  it("открывает LinkedIn и перебирает 5 вакансий", { timeout: 300_000 }, async () => {
    process.chdir(getProjectRoot());
    const { url } = loadCustomSearch(SEARCH_ID);
    process.env.LINKEDIN_MAX_JOBS = String(LIVE_JOB_COUNT);
    process.env.LINKEDIN_PREVIEW_ONLY = "1";
    process.env.LINKEDIN_SEARCH_URL_EXACT = "1";
    delete process.env.KEEP_BROWSER_OPEN_AFTER_SCAN;

    let context = null;
    let page = null;
    try {
      context = await openBrowserContext();
      page = context.pages()[0] ?? await context.newPage();
      const result = await scanUrlToReports(context, {
        url,
        page,
        previewOnly: true,
      });

      assert.notEqual(
        result.exitCode,
        2,
        "LinkedIn показал login/checkpoint. Сначала выполни npm run login.",
      );
      assert.equal(result.exitCode, 0, "скан должен завершиться без ошибки");
      assert.equal(result.reportPaths.length, 0, "preview не пишет reports/");
      assert.ok(Array.isArray(result.jobs), "scanUrlToReports возвращает jobs");
      assert.ok(result.jobs.length >= 1, `не открыли ни одной вакансии. url=${page.url()}`);
      assert.ok(
        result.jobs.length <= LIVE_JOB_COUNT,
        `открыли ${result.jobs.length} вакансий, лимит ${LIVE_JOB_COUNT}`,
      );
      if ((result.totalSeen ?? 0) >= LIVE_JOB_COUNT) {
        assert.equal(
          result.jobs.length,
          LIVE_JOB_COUNT,
          `ожидали ${LIVE_JOB_COUNT} вакансий, получили ${result.jobs.length}. url=${page.url()}`,
        );
      }

      for (const [index, job] of result.jobs.entries()) {
        assert.ok(String(job.title || "").trim(), `вакансия ${index + 1}: пустой title`);
        assert.match(
          String(job.link || ""),
          /\/jobs\/view\/|currentJobId=/i,
          `вакансия ${index + 1} (${job.title}): нет ссылки на вакансию`,
        );
      }
    } catch (err) {
      if (page) {
        await page.screenshot({
          path: "reports/linkedin-live-test-fail.png",
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
