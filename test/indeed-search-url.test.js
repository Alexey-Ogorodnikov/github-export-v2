/**
 * indeed-search-url.js — сборка и разбор URL поиска Indeed Canada.
 */
import assert from "node:assert/strict";
import { describe } from "node:test";

import {
  INDEED_CA_ORIGIN,
  INDEED_REMOTE_SC,
  buildIndeedSearchUrl,
  canonicalizeIndeedJobsSearchUrl,
  isIndeedJobsSearchUrl,
  parseIndeedSearchUrl,
  rewriteIndeedPostedDays,
} from "../scripts/indeed-search-url.js";
import { scenario } from "./helpers/scenario.js";

describe("isIndeedJobsSearchUrl / canonicalizeIndeedJobsSearchUrl", () => {
  scenario("ca.indeed.com/jobs → канонический URL", () => {
    const url = "https://ca.indeed.com/jobs?q=android";
    assert.equal(isIndeedJobsSearchUrl(url), true);
    assert.equal(canonicalizeIndeedJobsSearchUrl(url), url);
  });

  scenario("не indeed / не /jobs → «»", () => {
    assert.equal(canonicalizeIndeedJobsSearchUrl("https://www.linkedin.com/jobs/search/?q=x"), "");
    assert.equal(canonicalizeIndeedJobsSearchUrl("https://ca.indeed.com/viewjob?jk=abc"), "");
    assert.equal(isIndeedJobsSearchUrl("not a url"), false);
  });
});

describe("buildIndeedSearchUrl", () => {
  scenario("keywords + Canada по умолчанию", () => {
    const url = buildIndeedSearchUrl({ keywords: "Android developer" });
    const u = new URL(url);
    assert.equal(u.origin, INDEED_CA_ORIGIN);
    assert.equal(u.pathname, "/jobs");
    assert.equal(u.searchParams.get("q"), "Android developer");
    assert.equal(u.searchParams.get("l"), "Canada");
    assert.equal(u.searchParams.get("fromage"), "1");
    assert.equal(u.searchParams.get("sort"), "date");
    assert.equal(u.searchParams.get("sc"), null);
  });

  scenario("location и период 7 дней", () => {
    const url = buildIndeedSearchUrl({
      keywords: "Kotlin",
      location: "Montreal, QC",
      days: 7,
    });
    const u = new URL(url);
    assert.equal(u.searchParams.get("l"), "Montreal, QC");
    assert.equal(u.searchParams.get("fromage"), "7");
  });

  scenario("remote → sc=DSQF7", () => {
    const url = buildIndeedSearchUrl({ keywords: "dev", workType: "remote" });
    assert.equal(new URL(url).searchParams.get("sc"), INDEED_REMOTE_SC);
  });

  scenario("пустые keywords → ошибка", () => {
    assert.throws(() => buildIndeedSearchUrl({ keywords: "  " }), /keywords required/);
  });
});

describe("parseIndeedSearchUrl", () => {
  scenario("q, l, fromage, remote sc", () => {
    const url =
      "https://ca.indeed.com/jobs?q=android+developer&l=Toronto%2C+ON&fromage=2&sc=0kf%3Aattr(DSQF7)%3B";
    const parsed = parseIndeedSearchUrl(url);
    assert.equal(parsed.keywords, "android developer");
    assert.equal(parsed.city, "Toronto");
    assert.equal(parsed.country, "ON");
    assert.equal(parsed.days, 2);
    assert.equal(parsed.workType, "remote");
  });

  scenario("без remote sc → workType any", () => {
    const parsed = parseIndeedSearchUrl("https://ca.indeed.com/jobs?q=ios&l=Canada&fromage=1");
    assert.equal(parsed.workType, "any");
    assert.equal(parsed.country, "Canada");
    assert.equal(parsed.city, "");
  });
});

describe("rewriteIndeedPostedDays", () => {
  scenario("ставит fromage", () => {
    const url = "https://ca.indeed.com/jobs?q=test&fromage=14";
    const next = rewriteIndeedPostedDays(url, 1);
    assert.equal(new URL(next).searchParams.get("fromage"), "1");
  });

  scenario("не Indeed → без изменений", () => {
    const url = "https://www.linkedin.com/jobs/search/?keywords=x";
    assert.equal(rewriteIndeedPostedDays(url, 7), url);
  });
});
