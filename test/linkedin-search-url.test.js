/**
 * linkedin-search-url.js — сборка, разбор и нормализация URL поиска LinkedIn.
 */
import assert from "node:assert/strict";
import { after, describe } from "node:test";

import {
  applyLinkedInPostedDaysFromEnv,
  buildLinkedInSearchUrl,
  canonicalizeLinkedInJobsSearchUrl,
  daysFromLinkedInFTpr,
  formatSearchLocation,
  isLinkedInJobsSearchUrl,
  parseLinkedInSearchUrl,
  rewriteLinkedInPostedDays,
  SEARCH_REGIONS,
} from "../scripts/linkedin-search-url.js";
import { scenario } from "./helpers/scenario.js";

describe("formatSearchLocation", () => {
  scenario("город + страна → «City, Country»", () => {
    assert.equal(formatSearchLocation({ city: "Montréal", country: "Canada" }), "Montréal, Canada");
  });

  scenario("только город", () => {
    assert.equal(formatSearchLocation({ city: "Toronto" }), "Toronto");
  });

  scenario("только страна", () => {
    assert.equal(formatSearchLocation({ country: "Canada" }), "Canada");
  });

  scenario("legacy region=quebec → Québec, Canada", () => {
    assert.equal(formatSearchLocation({ region: "quebec" }), "Québec, Canada");
  });

  scenario("legacy region=canada → Canada", () => {
    assert.equal(formatSearchLocation({ region: "canada" }), "Canada");
  });

  scenario("пустые поля → пустая строка", () => {
    assert.equal(formatSearchLocation({}), "");
    assert.equal(formatSearchLocation({ region: "unknown" }), "");
  });
});

describe("daysFromLinkedInFTpr", () => {
  scenario("f_TPR=a… (alert) → 1 день", () => {
    assert.equal(daysFromLinkedInFTpr("a123456"), 1);
    assert.equal(daysFromLinkedInFTpr("A999"), 1);
  });

  scenario("r86400 → 1 день", () => {
    assert.equal(daysFromLinkedInFTpr("r86400"), 1);
  });

  scenario("r172800 → 2 дня", () => {
    assert.equal(daysFromLinkedInFTpr("r172800"), 2);
  });

  scenario("r604800 → 7 дней", () => {
    assert.equal(daysFromLinkedInFTpr("r604800"), 7);
  });

  scenario("нестандартный r259200 → округлённые дни", () => {
    assert.equal(daysFromLinkedInFTpr("r259200"), 3);
  });

  scenario("пустая строка → undefined", () => {
    assert.equal(daysFromLinkedInFTpr(""), undefined);
  });

  scenario("неизвестный формат → undefined", () => {
    assert.equal(daysFromLinkedInFTpr("bad"), undefined);
    assert.equal(daysFromLinkedInFTpr("r0"), undefined);
  });
});

describe("canonicalizeLinkedInJobsSearchUrl", () => {
  scenario("стандартный /jobs/search/ — принимается", () => {
    const url = "https://www.linkedin.com/jobs/search/?keywords=kotlin";
    assert.ok(canonicalizeLinkedInJobsSearchUrl(url).includes("/jobs/search/"));
  });

  scenario("/jobs/search-results/ → переписывается в /jobs/search/", () => {
    const url = "https://www.linkedin.com/jobs/search-results/?keywords=test";
    assert.match(canonicalizeLinkedInJobsSearchUrl(url), /\/jobs\/search\//);
    assert.doesNotMatch(canonicalizeLinkedInJobsSearchUrl(url), /search-results/);
  });

  scenario("удаляет currentJobId, referralSearchId, skipRedirect", () => {
    const url =
      "https://www.linkedin.com/jobs/search/?keywords=x&currentJobId=1&referralSearchId=2&skipRedirect=true";
    const canonical = canonicalizeLinkedInJobsSearchUrl(url);
    assert.ok(!canonical.includes("currentJobId="));
    assert.ok(!canonical.includes("referralSearchId="));
    assert.ok(!canonical.includes("skipRedirect="));
  });

  scenario("обрезает пробелы по краям", () => {
    const inner = "https://www.linkedin.com/jobs/search/?keywords=a";
    assert.equal(canonicalizeLinkedInJobsSearchUrl(`  ${inner}  `), inner);
  });

  scenario("пустая строка → «»", () => {
    assert.equal(canonicalizeLinkedInJobsSearchUrl(""), "");
    assert.equal(canonicalizeLinkedInJobsSearchUrl("   "), "");
  });

  scenario("не URL → «»", () => {
    assert.equal(canonicalizeLinkedInJobsSearchUrl("not-a-url"), "");
  });

  scenario("не linkedin.com → «»", () => {
    assert.equal(canonicalizeLinkedInJobsSearchUrl("https://example.com/jobs/search/"), "");
  });

  scenario("linkedin.com без /jobs/search → «»", () => {
    assert.equal(canonicalizeLinkedInJobsSearchUrl("https://www.linkedin.com/in/me/"), "");
  });
});

describe("isLinkedInJobsSearchUrl", () => {
  scenario("валидный search URL → true", () => {
    assert.equal(
      isLinkedInJobsSearchUrl("https://www.linkedin.com/jobs/search/?keywords=android"),
      true,
    );
  });

  scenario("профиль LinkedIn → false", () => {
    assert.equal(isLinkedInJobsSearchUrl("https://www.linkedin.com/in/user/"), false);
  });
});

describe("parseLinkedInSearchUrl", () => {
  scenario("keywords из параметра keywords", () => {
    const parsed = parseLinkedInSearchUrl(
      "https://www.linkedin.com/jobs/search/?keywords=Android+Dev&f_TPR=r86400",
    );
    assert.equal(parsed.keywords, "Android Dev");
  });

  scenario("keywords из alias keyword", () => {
    const parsed = parseLinkedInSearchUrl(
      "https://www.linkedin.com/jobs/search/?keyword=Kotlin&f_TPR=r86400",
    );
    assert.equal(parsed.keywords, "Kotlin");
  });

  scenario("keywords из alias query", () => {
    const parsed = parseLinkedInSearchUrl(
      "https://www.linkedin.com/jobs/search/?query=Rust&f_TPR=r86400",
    );
    assert.equal(parsed.keywords, "Rust");
  });

  scenario("location «City, Country» → city + country", () => {
    const parsed = parseLinkedInSearchUrl(
      "https://www.linkedin.com/jobs/search/?keywords=x&location=Toronto%2C+Canada&f_TPR=r86400",
    );
    assert.equal(parsed.city, "Toronto");
    assert.equal(parsed.country, "Canada");
  });

  scenario("location только страна → country без city", () => {
    const parsed = parseLinkedInSearchUrl(
      "https://www.linkedin.com/jobs/search/?keywords=x&location=Canada&f_TPR=r86400",
    );
    assert.equal(parsed.city, "");
    assert.equal(parsed.country, "Canada");
  });

  scenario("geoId Québec → country из справочника", () => {
    const parsed = parseLinkedInSearchUrl(
      `https://www.linkedin.com/jobs/search/?keywords=x&geoId=${SEARCH_REGIONS.quebec.geoId}&f_TPR=r86400`,
    );
    assert.equal(parsed.country, SEARCH_REGIONS.quebec.label);
  });

  scenario("f_WT=1/2/3 → onsite / remote / hybrid", () => {
    const base = "https://www.linkedin.com/jobs/search/?keywords=x&f_TPR=r86400";
    assert.equal(parseLinkedInSearchUrl(`${base}&f_WT=1`).workType, "onsite");
    assert.equal(parseLinkedInSearchUrl(`${base}&f_WT=2`).workType, "remote");
    assert.equal(parseLinkedInSearchUrl(`${base}&f_WT=3`).workType, "hybrid");
  });

  scenario("без f_WT → workType=any", () => {
    const parsed = parseLinkedInSearchUrl(
      "https://www.linkedin.com/jobs/search/?keywords=x&f_TPR=r86400",
    );
    assert.equal(parsed.workType, "any");
  });

  scenario("невалидный URL → исключение", () => {
    assert.throws(() => parseLinkedInSearchUrl("https://example.com/"), /invalid LinkedIn search url/);
  });
});

describe("buildLinkedInSearchUrl", () => {
  scenario("собирает URL с keywords, days, workType, location", () => {
    const url = buildLinkedInSearchUrl({
      keywords: "Android",
      days: 7,
      workType: "remote",
      city: "Toronto",
      country: "Canada",
    });
    const parsed = parseLinkedInSearchUrl(url);
    assert.equal(parsed.keywords, "Android");
    assert.equal(parsed.days, 7);
    assert.equal(parsed.workType, "remote");
    assert.equal(parsed.city, "Toronto");
    assert.equal(parsed.country, "Canada");
  });

  scenario("пустые keywords → исключение", () => {
    assert.throws(() => buildLinkedInSearchUrl({ keywords: "  " }), /keywords required/);
  });

  scenario("days вне [1,2,7] → default 1", () => {
    const url = buildLinkedInSearchUrl({ keywords: "test", days: 30 });
    assert.match(url, /f_TPR=r86400/);
  });

  scenario("workType=any — без f_WT", () => {
    const url = buildLinkedInSearchUrl({ keywords: "test", workType: "any", region: "quebec" });
    assert.ok(!url.includes("f_WT="));
  });

  scenario("region=quebec без city/country → location «Québec, Canada»", () => {
    const url = buildLinkedInSearchUrl({ keywords: "test", region: "quebec" });
    const location = new URL(url).searchParams.get("location");
    assert.equal(location, "Québec, Canada");
    assert.ok(!url.includes("geoId="));
  });

  scenario("region=canada без city → location «Canada»", () => {
    const url = buildLinkedInSearchUrl({ keywords: "test", region: "canada" });
    assert.ok(url.includes("location=Canada"));
    assert.ok(!url.includes("geoId="));
  });

  scenario("только geoId без location-текста → geoId в URL", () => {
    const url = buildLinkedInSearchUrl({ keywords: "test", geoId: "999" });
    assert.ok(url.includes("geoId=999"));
  });
});

describe("rewriteLinkedInPostedDays", () => {
  scenario("валидный LinkedIn jobs URL — выставляет f_TPR=r{seconds}", () => {
    const url = "https://www.linkedin.com/jobs/search/?keywords=test&f_TPR=a1";
    assert.match(rewriteLinkedInPostedDays(url, 2), /f_TPR=r172800/);
  });

  scenario("days ≤ 0 → URL без изменений", () => {
    const url = "https://www.linkedin.com/jobs/search/?keywords=test";
    assert.equal(rewriteLinkedInPostedDays(url, 0), url);
    assert.equal(rewriteLinkedInPostedDays(url, -5), url);
  });

  scenario("days не число → URL без изменений", () => {
    const url = "https://www.linkedin.com/jobs/search/?keywords=test";
    assert.equal(rewriteLinkedInPostedDays(url, NaN), url);
  });

  scenario("пустой URL → без изменений", () => {
    assert.equal(rewriteLinkedInPostedDays("", 7), "");
  });

  scenario("не LinkedIn → без изменений", () => {
    const url = "https://example.com/jobs/search/?keywords=test";
    assert.equal(rewriteLinkedInPostedDays(url, 7), url);
  });

  scenario("LinkedIn без job в path → без изменений", () => {
    const url = "https://www.linkedin.com/feed/";
    assert.equal(rewriteLinkedInPostedDays(url, 7), url);
  });

  scenario("битый URL → без изменений", () => {
    assert.equal(rewriteLinkedInPostedDays("not-a-url", 7), "not-a-url");
  });
});

describe("applyLinkedInPostedDaysFromEnv", () => {
  const original = process.env.LINKEDIN_JOB_POSTED_DAYS;

  after(() => {
    if (original === undefined) {
      delete process.env.LINKEDIN_JOB_POSTED_DAYS;
    } else {
      process.env.LINKEDIN_JOB_POSTED_DAYS = original;
    }
  });

  scenario("env не задан — URL без изменений", () => {
    delete process.env.LINKEDIN_JOB_POSTED_DAYS;
    const url = "https://www.linkedin.com/jobs/search/?keywords=test";
    assert.equal(applyLinkedInPostedDaysFromEnv(url), url);
  });

  scenario("env=7 — переписывает f_TPR", () => {
    process.env.LINKEDIN_JOB_POSTED_DAYS = "7";
    const url = "https://www.linkedin.com/jobs/search/?keywords=test";
    assert.match(applyLinkedInPostedDaysFromEnv(url), /f_TPR=r604800/);
  });

  scenario("env=abc — URL без изменений", () => {
    process.env.LINKEDIN_JOB_POSTED_DAYS = "abc";
    const url = "https://www.linkedin.com/jobs/search/?keywords=test";
    assert.equal(applyLinkedInPostedDaysFromEnv(url), url);
  });

  scenario("env=0 — URL без изменений", () => {
    process.env.LINKEDIN_JOB_POSTED_DAYS = "0";
    const url = "https://www.linkedin.com/jobs/search/?keywords=test";
    assert.equal(applyLinkedInPostedDaysFromEnv(url), url);
  });
});
