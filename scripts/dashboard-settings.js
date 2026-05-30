import fs from "node:fs";
import path from "node:path";

export const DEFAULT_MAX_JOBS_PER_SEARCH = 200;
export const MAX_MANDATORY_TAGS = 5;
export const DEFAULT_MANDATORY_TAGS = [
  { id: "tag-android", label: "Android" },
  { id: "tag-mobile", label: "Mobile" },
  { id: "tag-kotlin", label: "Kotlin" },
  { id: "tag-ai", label: "AI" },
];

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

export function normalizeMaxJobsPerSearch(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_JOBS_PER_SEARCH;
  }
  return Math.min(1000, parsed);
}

export function readDashboardSettings(projectRoot) {
  const filePath = settingsPath(projectRoot);
  if (!fs.existsSync(filePath)) {
    return {
      maxJobsPerSearch: DEFAULT_MAX_JOBS_PER_SEARCH,
      mandatoryTags: DEFAULT_MANDATORY_TAGS.map((tag) => ({ ...tag })),
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      maxJobsPerSearch: normalizeMaxJobsPerSearch(raw?.maxJobsPerSearch),
      mandatoryTags: normalizeMandatoryTags(raw?.mandatoryTags),
    };
  } catch {
    return {
      maxJobsPerSearch: DEFAULT_MAX_JOBS_PER_SEARCH,
      mandatoryTags: DEFAULT_MANDATORY_TAGS.map((tag) => ({ ...tag })),
    };
  }
}

export function writeDashboardSettings(projectRoot, patch) {
  const current = readDashboardSettings(projectRoot);
  const next = {
    maxJobsPerSearch:
      patch?.maxJobsPerSearch === undefined
        ? current.maxJobsPerSearch
        : normalizeMaxJobsPerSearch(patch.maxJobsPerSearch),
    mandatoryTags:
      patch?.mandatoryTags === undefined
        ? current.mandatoryTags
        : normalizeMandatoryTags(patch.mandatoryTags),
  };
  const dir = path.dirname(settingsPath(projectRoot));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath(projectRoot), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function getMaxJobsPerSearch(projectRoot) {
  return readDashboardSettings(projectRoot).maxJobsPerSearch;
}

export function getDashboardSettingsForApi(projectRoot) {
  const settings = readDashboardSettings(projectRoot);
  return {
    ...settings,
    defaultMaxJobsPerSearch: DEFAULT_MAX_JOBS_PER_SEARCH,
    maxMandatoryTags: MAX_MANDATORY_TAGS,
    defaultMandatoryTags: DEFAULT_MANDATORY_TAGS,
  };
}
