/**
 * dashboard-settings.js — нормализация настроек дашборда.
 */
import assert from "node:assert/strict";
import { describe } from "node:test";

import {
  DEFAULT_COMPANY_BLACKLIST,
  DEFAULT_MANDATORY_TAGS,
  DEFAULT_MAX_JOBS_PER_SEARCH,
  DEFAULT_SEARCH_SITE_IDS,
  MAX_MANDATORY_TAGS,
  normalizeCompanyBlacklist,
  normalizeJobPostedDays,
  normalizeMandatoryTags,
  normalizeMaxJobsPerSearch,
  normalizeSearchSiteIds,
} from "../scripts/dashboard-settings.js";
import { scenario } from "./helpers/scenario.js";

describe("normalizeMandatoryTags", () => {
  scenario("null / не массив → дефолтные теги", () => {
    assert.deepEqual(normalizeMandatoryTags(null), DEFAULT_MANDATORY_TAGS);
    assert.deepEqual(normalizeMandatoryTags({}), DEFAULT_MANDATORY_TAGS);
    assert.deepEqual(normalizeMandatoryTags("tags"), DEFAULT_MANDATORY_TAGS);
  });

  scenario("пустой массив → дефолтные теги", () => {
    assert.deepEqual(normalizeMandatoryTags([]), DEFAULT_MANDATORY_TAGS);
  });

  scenario("пустой label — пропускается", () => {
    const tags = normalizeMandatoryTags([{ label: "  " }, { label: "Valid" }]);
    assert.equal(tags.length, 1);
    assert.equal(tags[0].label, "Valid");
  });

  scenario("label обрезается до 40 символов", () => {
    const long = "A".repeat(50);
    const tags = normalizeMandatoryTags([{ id: "tag-a", label: long }]);
    assert.equal(tags[0].label.length, 40);
  });

  scenario("без id — генерируется из label", () => {
    const tags = normalizeMandatoryTags([{ label: "React Native" }]);
    assert.equal(tags[0].id, "tag-react-native");
  });

  scenario("дубликат id — суффикс -2, -3…", () => {
    const tags = normalizeMandatoryTags([
      { id: "tag-x", label: "One" },
      { id: "tag-x", label: "Two" },
    ]);
    assert.deepEqual(
      tags.map((t) => t.id),
      ["tag-x", "tag-x-2"],
    );
  });

  scenario("не больше MAX_MANDATORY_TAGS элементов", () => {
    const raw = Array.from({ length: MAX_MANDATORY_TAGS + 5 }, (_, i) => ({
      id: `tag-${i}`,
      label: `Tag ${i}`,
    }));
    assert.equal(normalizeMandatoryTags(raw).length, MAX_MANDATORY_TAGS);
  });

  scenario("валидный пользовательский список сохраняется", () => {
    const input = [
      { id: "tag-ios", label: "iOS" },
      { id: "tag-swift", label: "Swift" },
    ];
    assert.deepEqual(normalizeMandatoryTags(input), input);
  });
});

describe("normalizeCompanyBlacklist", () => {
  scenario("undefined / null → дефолтный чёрный список", () => {
    assert.deepEqual(normalizeCompanyBlacklist(undefined), DEFAULT_COMPANY_BLACKLIST);
    assert.deepEqual(normalizeCompanyBlacklist(null), DEFAULT_COMPANY_BLACKLIST);
  });

  scenario("не массив → дефолтный чёрный список", () => {
    assert.deepEqual(normalizeCompanyBlacklist("Acme"), DEFAULT_COMPANY_BLACKLIST);
  });

  scenario("пустой массив → []", () => {
    assert.deepEqual(normalizeCompanyBlacklist([]), []);
  });

  scenario("trim + дедуп без учёта регистра", () => {
    assert.deepEqual(normalizeCompanyBlacklist([" Acme ", "acme", "Beta", ""]), ["Acme", "Beta"]);
  });

  scenario("имя обрезается до 80 символов", () => {
    const long = "X".repeat(100);
    assert.equal(normalizeCompanyBlacklist([long])[0].length, 80);
  });

  scenario("пустые строки пропускаются", () => {
    assert.deepEqual(normalizeCompanyBlacklist(["", "  ", "RealCo"]), ["RealCo"]);
  });
});

describe("normalizeMaxJobsPerSearch", () => {
  scenario("валидное число возвращается как есть", () => {
    assert.equal(normalizeMaxJobsPerSearch(250), 250);
  });

  scenario("строка-число парсится", () => {
    assert.equal(normalizeMaxJobsPerSearch("150"), 150);
  });

  scenario("NaN / не число → DEFAULT", () => {
    assert.equal(normalizeMaxJobsPerSearch("abc"), DEFAULT_MAX_JOBS_PER_SEARCH);
    assert.equal(normalizeMaxJobsPerSearch(NaN), DEFAULT_MAX_JOBS_PER_SEARCH);
  });

  scenario("< 1 → DEFAULT", () => {
    assert.equal(normalizeMaxJobsPerSearch(0), DEFAULT_MAX_JOBS_PER_SEARCH);
    assert.equal(normalizeMaxJobsPerSearch(-10), DEFAULT_MAX_JOBS_PER_SEARCH);
  });

  scenario("> 1000 → 1000", () => {
    assert.equal(normalizeMaxJobsPerSearch(5000), 1000);
  });

  scenario("границы 1 и 1000", () => {
    assert.equal(normalizeMaxJobsPerSearch(1), 1);
    assert.equal(normalizeMaxJobsPerSearch(1000), 1000);
  });
});

describe("normalizeJobPostedDays", () => {
  scenario("1, 2, 7 — допустимые значения", () => {
    assert.equal(normalizeJobPostedDays(1), 1);
    assert.equal(normalizeJobPostedDays(2), 2);
    assert.equal(normalizeJobPostedDays(7), 7);
  });

  scenario("строка «7» парсится", () => {
    assert.equal(normalizeJobPostedDays("7"), 7);
  });

  scenario("3, 0, -1, NaN → default 1", () => {
    assert.equal(normalizeJobPostedDays(3), 1);
    assert.equal(normalizeJobPostedDays(0), 1);
    assert.equal(normalizeJobPostedDays(-1), 1);
    assert.equal(normalizeJobPostedDays("bad"), 1);
  });
});

describe("normalizeSearchSiteIds", () => {
  scenario("undefined / не массив → LinkedIn + Indeed Canada", () => {
    assert.deepEqual(normalizeSearchSiteIds(undefined), DEFAULT_SEARCH_SITE_IDS);
    assert.deepEqual(normalizeSearchSiteIds(null), DEFAULT_SEARCH_SITE_IDS);
    assert.deepEqual(normalizeSearchSiteIds("linkedin"), DEFAULT_SEARCH_SITE_IDS);
  });

  scenario("пустой массив → дефолт", () => {
    assert.deepEqual(normalizeSearchSiteIds([]), DEFAULT_SEARCH_SITE_IDS);
  });

  scenario("неизвестные id пропускаются", () => {
    assert.deepEqual(normalizeSearchSiteIds(["linkedin", "glassdoor", "indeed-ca"]), [
      "linkedin",
      "indeed-ca",
    ]);
  });

  scenario("дубликаты убираются, порядок сохраняется", () => {
    assert.deepEqual(normalizeSearchSiteIds(["indeed-ca", "linkedin", "indeed-ca"]), [
      "indeed-ca",
      "linkedin",
    ]);
  });

  scenario("один валидный сайт сохраняется", () => {
    assert.deepEqual(normalizeSearchSiteIds(["indeed-ca"]), ["indeed-ca"]);
  });

  scenario("только неизвестные id → дефолт", () => {
    assert.deepEqual(normalizeSearchSiteIds(["monster", ""]), DEFAULT_SEARCH_SITE_IDS);
  });
});
