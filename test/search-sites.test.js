/**
 * search-sites.js — список сайтов поиска и сборка URL под каждый.
 */
import assert from "node:assert/strict";
import { describe } from "node:test";

import {
  AVAILABLE_SEARCH_SITES,
  DEFAULT_SEARCH_SITE_IDS,
  buildEnabledSiteSearchUrls,
} from "../scripts/search-sites.js";
import { scenario } from "./helpers/scenario.js";

const linkedInUrl =
  "https://www.linkedin.com/jobs/search/?keywords=android+developer&geoId=101330853&f_TPR=r86400";

describe("AVAILABLE_SEARCH_SITES", () => {
  scenario("пока два сайта: LinkedIn и Indeed Canada", () => {
    assert.deepEqual(
      AVAILABLE_SEARCH_SITES.map((site) => site.id),
      ["linkedin", "indeed-ca"],
    );
    assert.deepEqual(DEFAULT_SEARCH_SITE_IDS, ["linkedin", "indeed-ca"]);
    assert.equal(
      AVAILABLE_SEARCH_SITES.find((site) => site.id === "indeed-ca")?.origin,
      "https://ca.indeed.com",
    );
  });
});

describe("buildEnabledSiteSearchUrls", () => {
  scenario("оба сайта: LinkedIn URL + Indeed из keywords/geoId", () => {
    const urls = buildEnabledSiteSearchUrls({
      url: linkedInUrl,
      keywords: "android developer",
      days: 1,
      siteIds: ["linkedin", "indeed-ca"],
    });
    assert.equal(urls.length, 2);
    assert.equal(urls[0].siteId, "linkedin");
    assert.match(urls[0].url, /linkedin\.com/);
    assert.equal(urls[1].siteId, "indeed-ca");
    const indeed = new URL(urls[1].url);
    assert.equal(indeed.origin, "https://ca.indeed.com");
    assert.equal(indeed.searchParams.get("q"), "android developer");
    assert.equal(indeed.searchParams.get("l"), "Montreal, QC");
    assert.equal(indeed.searchParams.get("fromage"), "1");
  });

  scenario("только Indeed — LinkedIn URL не открывается", () => {
    const urls = buildEnabledSiteSearchUrls({
      url: linkedInUrl,
      keywords: "Kotlin",
      city: "Montréal",
      country: "Canada",
      workType: "remote",
      days: 7,
      siteIds: ["indeed-ca"],
    });
    assert.equal(urls.length, 1);
    assert.equal(urls[0].siteId, "indeed-ca");
    const indeed = new URL(urls[0].url);
    assert.equal(indeed.searchParams.get("q"), "Kotlin");
    assert.equal(indeed.searchParams.get("l"), "Montréal, Canada");
    assert.equal(indeed.searchParams.get("fromage"), "7");
    assert.ok(indeed.searchParams.get("sc"));
  });

  scenario("только LinkedIn — Indeed не строится", () => {
    const urls = buildEnabledSiteSearchUrls({
      url: linkedInUrl,
      days: 2,
      siteIds: ["linkedin"],
    });
    assert.equal(urls.length, 1);
    assert.equal(urls[0].siteId, "linkedin");
    assert.match(urls[0].url, /f_TPR=r172800/);
  });

  scenario("без keywords и без LinkedIn URL — Indeed пропускается", () => {
    const urls = buildEnabledSiteSearchUrls({
      url: "",
      keywords: "",
      siteIds: ["indeed-ca"],
    });
    assert.deepEqual(urls, []);
  });
});
