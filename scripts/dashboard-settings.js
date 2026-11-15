import fs from "node:fs";
import path from "node:path";
import {
  AVAILABLE_SEARCH_SITES,
  DEFAULT_SEARCH_SITE_IDS,
  normalizeSearchSiteIds,
} from "./search-sites.js";

export { AVAILABLE_SEARCH_SITES, DEFAULT_SEARCH_SITE_IDS, normalizeSearchSiteIds };

export const DEFAULT_MAX_JOBS_PER_SEARCH = 200;
export const DEFAULT_JOB_POSTED_DAYS = 1;
export const ALLOWED_JOB_POSTED_DAYS = [1, 2, 7];
export const MAX_MANDATORY_TAGS = 5;
export const DEFAULT_MANDATORY_TAGS = [
  { id: "tag-android", label: "Android" },
  { id: "tag-mobile", label: "Mobile" },
  { id: "tag-kotlin", label: "Kotlin" },
  { id: "tag-ai", label: "AI" },
];
export const DEFAULT_COMPANY_BLACKLIST = [];

function settingsPath(projectRoot) {
  return path.join(projectRoot, "data", "dashboard-settings.json");
}

function slugifyTagId(label) {
  const base = String(label || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base ? `tag-${base}` : `tag-${Date.now().toString(36)}`;
}

export function normalizeMandatoryTags(raw) {
  if (!Array.isArray(raw)) {
    return DEFAULT_MANDATORY_TAGS.map((tag) => ({ ...tag }));
  }

  const next = [];
  const seenIds = new Set();
  for (const item of raw) {
    const label = String(item?.label || "").trim().slice(0, 40);
    if (!label) {
      continue;
    }
    let id = String(item?.id || "").trim();
    if (!id) {
      id = slugifyTagId(label);
    }
    let uniqueId = id;
    let n = 2;
    while (seenIds.has(uniqueId)) {
      uniqueId = `${id}-${n}`;
      n += 1;
    }
    seenIds.add(uniqueId);
    next.push({ id: uniqueId, label });
    if (next.length >= MAX_MANDATORY_TAGS) {
      break;
    }
  }

  return next.length ? next : DEFAULT_MANDATORY_TAGS.map((tag) => ({ ...tag }));
}

export function normalizeCompanyBlacklist(raw) {
  if (raw === undefined || raw === null) {
    return [...DEFAULT_COMPANY_BLACKLIST];
  }
  if (!Array.isArray(raw)) {
    return [...DEFAULT_COMPANY_BLACKLIST];
  }
  const seen = new Set();
  const next = [];
  for (const item of raw) {
    const name = String(item || "").trim().slice(0, 80);
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(name);
  }
  return next;
}

export function normalizeMaxJobsPerSearch(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_JOBS_PER_SEARCH;
  }
  return Math.min(1000, parsed);
}

export function normalizeJobPostedDays(value) {
  const parsed = Number.parseInt(value, 10);
  if (ALLOWED_JOB_POSTED_DAYS.includes(parsed)) {
    return parsed;
  }
  return DEFAULT_JOB_POSTED_DAYS;
}

function emptyDashboardSettings() {
  return {
    maxJobsPerSearch: DEFAULT_MAX_JOBS_PER_SEARCH,
    jobPostedDays: DEFAULT_JOB_POSTED_DAYS,
    mandatoryTags: DEFAULT_MANDATORY_TAGS.map((tag) => ({ ...tag })),
    companyBlacklist: [...DEFAULT_COMPANY_BLACKLIST],
    searchSiteIds: [...DEFAULT_SEARCH_SITE_IDS],
  };
}

export function readDashboardSettings(projectRoot) {
  const filePath = settingsPath(projectRoot);
  if (!fs.existsSync(filePath)) {
    return emptyDashboardSettings();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      maxJobsPerSearch: normalizeMaxJobsPerSearch(raw?.maxJobsPerSearch),
      jobPostedDays: normalizeJobPostedDays(raw?.jobPostedDays),
      mandatoryTags: normalizeMandatoryTags(raw?.mandatoryTags),
      companyBlacklist: normalizeCompanyBlacklist(raw?.companyBlacklist),
      searchSiteIds: normalizeSearchSiteIds(raw?.searchSiteIds),
    };
  } catch {
    return emptyDashboardSettings();
  }
}

export function writeDashboardSettings(projectRoot, patch) {
  const current = readDashboardSettings(projectRoot);
  const next = {
    maxJobsPerSearch:
      patch?.maxJobsPerSearch === undefined
        ? current.maxJobsPerSearch
        : normalizeMaxJobsPerSearch(patch.maxJobsPerSearch),
    jobPostedDays:
      patch?.jobPostedDays === undefined
        ? current.jobPostedDays
        : normalizeJobPostedDays(patch.jobPostedDays),
    mandatoryTags:
      patch?.mandatoryTags === undefined
        ? current.mandatoryTags
        : normalizeMandatoryTags(patch.mandatoryTags),
    companyBlacklist:
      patch?.companyBlacklist === undefined
        ? current.companyBlacklist
        : normalizeCompanyBlacklist(patch.companyBlacklist),
    searchSiteIds:
      patch?.searchSiteIds === undefined
        ? current.searchSiteIds
        : normalizeSearchSiteIds(patch.searchSiteIds),
  };
  const dir = path.dirname(settingsPath(projectRoot));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath(projectRoot), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function getMaxJobsPerSearch(projectRoot) {
  return readDashboardSettings(projectRoot).maxJobsPerSearch;
}

export function getJobPostedDays(projectRoot) {
  return readDashboardSettings(projectRoot).jobPostedDays;
}

export function getSearchSiteIds(projectRoot) {
  return readDashboardSettings(projectRoot).searchSiteIds;
}

export function getDashboardSettingsForApi(projectRoot) {
  const settings = readDashboardSettings(projectRoot);
  return {
    ...settings,
    defaultMaxJobsPerSearch: DEFAULT_MAX_JOBS_PER_SEARCH,
    defaultJobPostedDays: DEFAULT_JOB_POSTED_DAYS,
    allowedJobPostedDays: ALLOWED_JOB_POSTED_DAYS,
    maxMandatoryTags: MAX_MANDATORY_TAGS,
    defaultMandatoryTags: DEFAULT_MANDATORY_TAGS,
    defaultCompanyBlacklist: DEFAULT_COMPANY_BLACKLIST,
    availableSearchSites: AVAILABLE_SEARCH_SITES,
    defaultSearchSiteIds: DEFAULT_SEARCH_SITE_IDS,
  };
}
