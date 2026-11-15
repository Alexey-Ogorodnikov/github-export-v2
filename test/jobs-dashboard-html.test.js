/**
 * jobs-dashboard.html — инварианты разметки (без Ask Ollama, вёрстка карточек).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "node:test";

import { scenario } from "./helpers/scenario.js";

const dashboardHtmlPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "web",
  "jobs-dashboard.html",
);
const html = readFileSync(dashboardHtmlPath, "utf8");

describe("jobs-dashboard.html", () => {
  scenario("нет строк локализации askOllama", () => {
    assert.doesNotMatch(html, /askOllama/);
  });

  scenario("нет data-ollama-* атрибутов", () => {
    assert.doesNotMatch(html, /data-ollama-/);
  });

  scenario("нет вызовов /api/job-ask", () => {
    assert.doesNotMatch(html, /\/api\/job-ask/);
  });

  scenario("нет CSS-классов btn-ollama / job-ollama", () => {
    assert.doesNotMatch(html, /btn-ollama/);
    assert.doesNotMatch(html, /job-ollama/);
  });

  scenario("нет обёртки card-head (убрана вместе с Ask Ollama)", () => {
    assert.doesNotMatch(html, /class="card-head"/);
  });

  scenario("card-actions позиционируются absolute в правом верхнем углу", () => {
    assert.match(html, /\.card-actions[\s\S]*position:\s*absolute/);
    assert.match(html, /\.card-actions[\s\S]*top:\s*12px/);
    assert.match(html, /\.card-actions[\s\S]*right:\s*12px/);
  });

  scenario("карточка резервирует место под кнопки (padding-right)", () => {
    assert.match(html, /\.card[\s\S]*padding-right:\s*11rem/);
  });

  scenario("есть кнопка Copy link рядом с LinkedIn", () => {
    assert.match(html, /data-copy-job-link/);
    assert.match(html, /\.btn-copy-link/);
    assert.match(html, /\.linkedin-link-row/);
    assert.match(html, /copyLink:/);
    assert.match(html, /copyLinkTitle:/);
    assert.match(html, /copyLinkCopied:/);
    assert.match(
      html,
      /linkedin-link-row[\s\S]*jobDetailsLabel\(job\.link\)[\s\S]*\$\{copyLinkBtn\}/,
    );
  });

  scenario("в настройках есть список сайтов поиска", () => {
    assert.match(html, /id="searchSitesControls"/);
    assert.match(html, /searchSites:/);
    assert.match(html, /searchSitesHint:/);
    assert.match(html, /indeedDetails:/);
    assert.match(html, /function jobDetailsLabel/);
  });

  scenario("есть OR-фильтр Lead+ для ролей выше IC", () => {
    assert.match(html, /id="leadPlusFilter"/);
    assert.match(html, /LEAD_PLUS_PATTERNS/);
    assert.match(html, /jobMatchesLeadPlusFilter/);
    assert.match(html, /leadPlus:/);
    assert.match(html, /leadPlusHint:/);
  });
});
