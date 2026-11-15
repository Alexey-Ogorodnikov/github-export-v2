/**
 * dashboard-db.js — extractJobKey: стабильный ключ вакансии.
 */
import assert from "node:assert/strict";
import { describe } from "node:test";

import { extractJobKey } from "../scripts/dashboard-db.js";
import { scenario } from "./helpers/scenario.js";

describe("extractJobKey", () => {
  scenario("стандартный /jobs/view/{id}/ → numeric id", () => {
    assert.equal(
      extractJobKey({ link: "https://www.linkedin.com/jobs/view/1234567890/" }),
      "1234567890",
    );
  });

  scenario("URL без trailing slash", () => {
    assert.equal(
      extractJobKey({ link: "https://www.linkedin.com/jobs/view/999" }),
      "999",
    );
  });

  scenario("регистр в path не важен", () => {
    assert.equal(
      extractJobKey({ link: "https://www.linkedin.com/Jobs/View/42/" }),
      "42",
    );
  });

  scenario("query-параметры после id — id всё равно извлекается", () => {
    assert.equal(
      extractJobKey({ link: "https://www.linkedin.com/jobs/view/555/?ref=share" }),
      "555",
    );
  });

  scenario("нет numeric id — fallback на trimmed link", () => {
    assert.equal(
      extractJobKey({ link: "  https://example.com/job/abc  " }),
      "https://example.com/job/abc",
    );
  });

  scenario("пустой / пробельный link → «»", () => {
    assert.equal(extractJobKey({}), "");
    assert.equal(extractJobKey({ link: "" }), "");
    assert.equal(extractJobKey({ link: "   " }), "");
  });

  scenario("null job → «»", () => {
    assert.equal(extractJobKey(null), "");
  });

  scenario("числовой link → String(link) как fallback", () => {
    assert.equal(extractJobKey({ link: 12345 }), "12345");
  });

  scenario("Indeed jk из query → стабильный ключ", () => {
    assert.equal(
      extractJobKey({ link: "https://ca.indeed.com/viewjob?jk=abc123def456&from=serp" }),
      "abc123def456",
    );
  });
});
