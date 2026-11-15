/**
 * dashboard-scenarios.js — параметры сохранённых поисков, заголовки и описания.
 */
import assert from "node:assert/strict";
import { describe } from "node:test";

import {
  buildScenarioDescription,
  buildScenarioFromParams,
  buildScenarioTitle,
  normalizeSearchParams,
} from "../scripts/dashboard-scenarios.js";
import { scenario } from "./helpers/scenario.js";

const manualParams = {
  keywords: "Kotlin",
  days: 7,
  workType: "remote",
  country: "Canada",
  city: "Québec",
};

describe("normalizeSearchParams", () => {
  scenario("ручной ввод — все поля сохраняются", () => {
    assert.deepEqual(normalizeSearchParams(manualParams), manualParams);
  });

  scenario("невалидный workType → any", () => {
    assert.equal(normalizeSearchParams({ keywords: "x", workType: "spaceship" }).workType, "any");
  });

  scenario("workType приводится к lower case", () => {
    assert.equal(normalizeSearchParams({ keywords: "x", workType: "REMOTE" }).workType, "remote");
  });

  scenario("days вне [1,2,7] → 1", () => {
    assert.equal(normalizeSearchParams({ keywords: "x", days: 14 }).days, 1);
    assert.equal(normalizeSearchParams({ keywords: "x", days: NaN }).days, 1);
  });

  scenario("legacy region=quebec → Canada + Québec", () => {
    const p = normalizeSearchParams({ keywords: "dev", region: "quebec" });
    assert.equal(p.country, "Canada");
    assert.equal(p.city, "Québec");
  });

  scenario("legacy region=canada → Canada без city", () => {
    const p = normalizeSearchParams({ keywords: "dev", region: "canada" });
    assert.equal(p.country, "Canada");
    assert.equal(p.city, "");
  });

  scenario("LinkedIn URL имеет приоритет над ручными полями", () => {
    const url =
      "https://www.linkedin.com/jobs/search/?keywords=android&location=Toronto%2C+Canada&f_TPR=r604800&f_WT=2";
    const p = normalizeSearchParams({ url, keywords: "ignored", days: 1, workType: "onsite" });
    assert.equal(p.keywords, "android");
    assert.equal(p.days, 7);
    assert.equal(p.workType, "remote");
    assert.equal(p.city, "Toronto");
  });

  scenario("битый URL в поле url — fallback на ручные поля", () => {
    const p = normalizeSearchParams({ url: "https://example.com/", keywords: "fallback", days: 2 });
    assert.equal(p.keywords, "fallback");
    assert.equal(p.days, 2);
  });

  scenario("пустые keywords из ручного ввода", () => {
    assert.equal(normalizeSearchParams({ keywords: "  " }).keywords, "");
  });
});

describe("buildScenarioTitle", () => {
  scenario("содержит keywords, локацию, формат работы и период", () => {
    const title = buildScenarioTitle({
      keywords: "Android",
      country: "Canada",
      city: "Montréal",
      workType: "hybrid",
      days: 2,
    });
    assert.match(title, /Android/);
    assert.match(title, /Montréal, Canada/);
    assert.match(title, /Hybrid/);
    assert.match(title, /2 дня/);
  });

  scenario("без локации — placeholder «…»", () => {
    assert.match(buildScenarioTitle({ keywords: "Dev", workType: "any", days: 1 }), /…/);
  });

  scenario("все workType: any / remote / hybrid / onsite", () => {
    for (const workType of ["any", "remote", "hybrid", "onsite"]) {
      const title = buildScenarioTitle({ keywords: "X", workType, days: 1 });
      assert.ok(title.length > 0);
    }
  });

  scenario("все периоды: 1 / 2 / 7 дней", () => {
    assert.match(buildScenarioTitle({ keywords: "X", days: 1, workType: "any" }), /1 день/);
    assert.match(buildScenarioTitle({ keywords: "X", days: 2, workType: "any" }), /2 дня/);
    assert.match(buildScenarioTitle({ keywords: "X", days: 7, workType: "any" }), /7 дней/);
  });
});

describe("buildScenarioDescription", () => {
  scenario("русское описание с keywords, remote и 24 часами", () => {
    const d = buildScenarioDescription({
      keywords: "Kotlin",
      country: "Canada",
      city: "",
      workType: "remote",
      days: 1,
    });
    assert.match(d, /LinkedIn: Kotlin/);
    assert.match(d, /remote/);
    assert.match(d, /последние 24 часа/);
  });

  scenario("hybrid + 7 дней", () => {
    const d = buildScenarioDescription({
      keywords: "PM",
      country: "Canada",
      city: "Toronto",
      workType: "hybrid",
      days: 7,
    });
    assert.match(d, /hybrid/);
    assert.match(d, /последние 7 дней/);
  });
});

describe("buildScenarioFromParams", () => {
  scenario("из ручных params — url, title, description", () => {
    const built = buildScenarioFromParams(manualParams);
    assert.ok(built.url.includes("keywords=Kotlin"));
    assert.match(built.title, /Kotlin/);
    assert.match(built.description, /LinkedIn: Kotlin/);
  });

  scenario("из LinkedIn URL — парсит и строит метаданные", () => {
    const url =
      "https://www.linkedin.com/jobs/search/?keywords=ios&location=Canada&f_TPR=r86400&f_WT=2";
    const built = buildScenarioFromParams({ url });
    assert.equal(built.keywords, "ios");
    assert.equal(built.workType, "remote");
    assert.equal(built.url, url);
  });

  scenario("кастомный title переопределяет автогenerated", () => {
    const built = buildScenarioFromParams({ ...manualParams, title: "My search" });
    assert.equal(built.title, "My search");
  });

  scenario("без keywords (ручной ввод) → исключение", () => {
    assert.throws(() => buildScenarioFromParams({ days: 1 }), /keywords required/);
  });

  scenario("невалидный LinkedIn URL → исключение", () => {
    assert.throws(
      () => buildScenarioFromParams({ url: "https://example.com/jobs/search/" }),
      /invalid LinkedIn search url/,
    );
  });
});
