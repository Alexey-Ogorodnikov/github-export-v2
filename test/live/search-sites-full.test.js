/**
 * Полный production-цикл: скан LinkedIn + Indeed → *-raw.md / *-links.md → Ollama → dashboard.
 *
 * Не входит в `npm test`. Запуск: npm run test:sites:full
 *
 * Нужны: Google Chrome, сессия `npm run login`, Ollama, свободный browser-profile.
 * Лимит вакансий на сайт ограничен (не 500 из настроек), чтобы прогон укладывался в таймаут.
 *
 * Сценарии:
 * - Android developer Montreal: полный цикл на LinkedIn и Indeed Canada
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { extractJobKey } from "../../scripts/dashboard-db.js";
import { readDashboardSettings } from "../../scripts/dashboard-settings.js";
import { getProjectRoot, isOllamaReady, loadCustomSearch } from "../../scripts/run-cli.js";

const SEARCH_ID = "android-developer-101330853-any-r86400-any-1d";
const LIVE_JOB_COUNT = 5;
const TEST_TIMEOUT_MS = 1_500_000;

function listNewReports(reportsDir, sinceMs, suffix) {
  if (!fs.existsSync(reportsDir)) {
    return [];
  }
  return fs
    .readdirSync(reportsDir)
    .filter((name) => name.endsWith(suffix))
    .map((name) => {
      const fullPath = path.join(reportsDir, name);
      return { name, mtime: fs.statSync(fullPath).mtimeMs, fullPath };
    })
    .filter((entry) => entry.mtime >= sinceMs)
    .sort((a, b) => a.mtime - b.mtime);
}

function headerValue(content, name) {
  const match = content.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : "";
}

function extractJobLinks(content) {
  return [...content.matchAll(/^Link:\s*(.+)$/gm)]
    .map((match) => match[1].trim())
    .filter((link) => link && link !== "not found");
}

function parseCount(content, name) {
  const raw = headerValue(content, name);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

describe("Search sites full cycle", () => {
  it("полный цикл Android developer Montreal: отчёты + Ollama + дашборд", { timeout: TEST_TIMEOUT_MS }, async () => {
    const projectRoot = getProjectRoot();
    process.chdir(projectRoot);

    assert.ok(
      await isOllamaReady(),
      "Ollama не отвечает. Запусти Ollama и повтори npm run test:sites:full.",
    );

    const settings = readDashboardSettings(projectRoot);
    assert.ok(
      settings.searchSiteIds.includes("linkedin") && settings.searchSiteIds.includes("indeed-ca"),
      `в настройках должны быть LinkedIn и Indeed Canada, сейчас: ${settings.searchSiteIds.join(", ")}`,
    );

    const loaded = loadCustomSearch(SEARCH_ID);
    assert.match(loaded.name, /Android developer/i);

    const snapshotPath = path.join(projectRoot, "reports", "dashboard-jobs.json");
    let jobsBefore = 0;
    try {
      jobsBefore = JSON.parse(fs.readFileSync(snapshotPath, "utf8")).jobs?.length || 0;
    } catch {
      jobsBefore = 0;
    }

    const reportsDir = path.join(projectRoot, "reports");
    const sessionStart = Date.now();
    const env = {
      ...process.env,
      DASHBOARD_SKIP_SERVE: "1",
      DASHBOARD_SCENARIO_ID: SEARCH_ID,
      LINKEDIN_MAX_JOBS: String(LIVE_JOB_COUNT),
      PREPROCESS_SESSION_START_MS: String(sessionStart),
      LINKEDIN_SEARCH_URL_EXACT: "1",
      LINKEDIN_STEALTH_ARGS: "1",
    };
    delete env.LINKEDIN_PREVIEW_ONLY;
    delete env.KEEP_BROWSER_OPEN_AFTER_SCAN;
    delete env.LINKEDIN_JOB_POSTED_DAYS;

    console.log(`Full cycle: ${loaded.name}`);
    console.log(`Sites: LinkedIn, Indeed Canada (up to ${LIVE_JOB_COUNT} jobs each)`);
    console.log("");

    const result = spawnSync(
      process.execPath,
      [
        path.join(projectRoot, "scripts", "run-custom-search.js"),
        "--search-id",
        SEARCH_ID,
        "--live",
        "--preprocess-only",
      ],
      {
        cwd: projectRoot,
        env,
        stdio: "inherit",
        timeout: TEST_TIMEOUT_MS - 15_000,
      },
    );

    assert.equal(
      result.status,
      0,
      result.error
        ? `пайплайн не запустился: ${result.error.message}`
        : `пайплайн завершился с кодом ${result.status}`,
    );

    const rawReports = listNewReports(reportsDir, sessionStart, "-raw.md");
    const linkReports = listNewReports(reportsDir, sessionStart, "-links.md");
    assert.ok(
      rawReports.length >= 2,
      `ожидали ≥2 новых *-raw.md, получили ${rawReports.length}: ${rawReports.map((item) => item.name).join(", ")}`,
    );
    assert.ok(
      linkReports.length >= 2,
      `ожидали ≥2 новых *-links.md, получили ${linkReports.length}`,
    );

    const bySource = {};
    for (const report of rawReports) {
      const content = fs.readFileSync(report.fullPath, "utf8");
      const source = headerValue(content, "Source").toLowerCase();
      assert.ok(source, `${report.name}: нет Source`);
      assert.equal(
        headerValue(content, "Scenario ID"),
        SEARCH_ID,
        `${report.name}: Scenario ID должен быть ${SEARCH_ID}`,
      );
      assert.ok(headerValue(content, "Search URL"), `${report.name}: нет Search URL`);
      const jobCount = extractJobLinks(content).length;
      const totalSeen = parseCount(content, "Total seen on search");
      const skipped = parseCount(content, "Skipped existing");
      assert.ok(
        jobCount >= 1 || totalSeen >= 1 || skipped >= 1,
        `${report.name} (${source}): пустой отчёт — нет вакансий, totalSeen и skipped`,
      );
      bySource[source] = { ...report, content, jobCount, totalSeen, skipped };
      console.log(
        `${source}: ${report.name} — jobs=${jobCount}, seen=${totalSeen}, skipped=${skipped}`,
      );
    }

    assert.ok(bySource.linkedin, `нет LinkedIn *-raw.md среди ${rawReports.map((item) => item.name).join(", ")}`);
    assert.ok(bySource.indeed, `нет Indeed *-raw.md среди ${rawReports.map((item) => item.name).join(", ")}`);
    assert.match(headerValue(bySource.linkedin.content, "Search URL"), /linkedin\.com/i);
    assert.match(headerValue(bySource.indeed.content, "Search URL"), /indeed\.com/i);

    for (const report of rawReports) {
      const linksName = report.name.replace(/-raw\.md$/, "-links.md");
      assert.ok(
        linkReports.some((item) => item.name === linksName),
        `нет парного ${linksName} для ${report.name}`,
      );
    }

    assert.ok(fs.existsSync(snapshotPath), "нет reports/dashboard-jobs.json");
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    const generatedAt = Date.parse(snapshot.generated_at || "");
    assert.ok(
      Number.isFinite(generatedAt) && generatedAt >= sessionStart - 1000,
      `dashboard-jobs.json не обновлён в этом прогоне (generated_at=${snapshot.generated_at})`,
    );
    assert.ok(Array.isArray(snapshot.jobs) && snapshot.jobs.length > 0, "дашборд без вакансий");
    assert.ok(
      snapshot.jobs.length >= jobsBefore,
      `дашборд сжался ${jobsBefore} → ${snapshot.jobs.length}`,
    );

    const processed = new Set(snapshot.reports_processed || []);
    for (const report of rawReports) {
      assert.ok(
        processed.has(report.name),
        `${report.name} нет в reports_processed`,
      );
    }

    const dashboardKeys = new Set(
      snapshot.jobs.map((job) => extractJobKey(job)).filter(Boolean),
    );
    const reportJobs = [];
    for (const source of ["linkedin", "indeed"]) {
      const links = extractJobLinks(bySource[source].content);
      for (const link of links) {
        const key = extractJobKey({ link });
        reportJobs.push({ source, link, key });
        assert.ok(key, `${source}: не разобрали ключ вакансии ${link}`);
        assert.ok(
          dashboardKeys.has(key),
          `${source}: вакансия из отчёта не попала в дашборд: ${link}`,
        );
      }
    }
    assert.ok(
      reportJobs.some((job) => job.source === "linkedin") || bySource.linkedin.skipped >= 1,
      "LinkedIn не дал ни новых вакансий, ни skipped existing",
    );
    assert.ok(
      reportJobs.some((job) => job.source === "indeed") || bySource.indeed.skipped >= 1,
      "Indeed не дал ни новых вакансий, ни skipped existing",
    );

    const dbPath = path.join(projectRoot, "data", "dashboard.db");
    assert.ok(fs.existsSync(dbPath), "нет data/dashboard.db после preprocess");

    const searchConfig = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "custom-searches", `${SEARCH_ID}.json`), "utf8"),
    );
    const statsAt = Date.parse(searchConfig.lastRunStats?.at || "");
    assert.ok(
      Number.isFinite(statsAt) && statsAt >= sessionStart - 1000,
      `lastRunStats.at не обновлён (${searchConfig.lastRunStats?.at})`,
    );
    assert.ok(
      Number(searchConfig.lastRunStats?.found) >= 0,
      "lastRunStats.found должен быть числом",
    );

    console.log(
      `Dashboard: ${snapshot.jobs.length} jobs, generated_at=${snapshot.generated_at}, `
      + `report jobs in dashboard=${reportJobs.length}`,
    );
  });
});
