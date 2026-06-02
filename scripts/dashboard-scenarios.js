import fs from "node:fs";
import path from "node:path";
import {
  buildLinkedInSearchUrl,
  canonicalizeLinkedInJobsSearchUrl,
  formatSearchLocation,
  isLinkedInJobsSearchUrl,
  parseLinkedInSearchUrl,
} from "./linkedin-search-url.js";

/** @typedef {{ id: string, title: string, description: string, url: string, keywords?: string, days?: number, workType?: string, country?: string, city?: string, region?: string, lastRunStats?: { found: number, added: number, skipped?: number, totalSeen?: number, at: string } }} Scenario */

const WORK_TYPE_DESC = {
  any: "любой формат работы",
  remote: "remote",
  hybrid: "hybrid",
  onsite: "on-site",
};

const WORK_TYPE_TITLE = {
  any: "Any",
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

const DAYS_DESC = {
  1: "последние 24 часа",
  2: "последние 2 дня",
  7: "последние 7 дней",
};

const DAYS_TITLE = {
  1: "1 день",
  2: "2 дня",
  7: "7 дней",
};

/** @type {Scenario[]} */
export const BUILTIN_SCENARIOS = [];

/** @type {Scenario[]} */
let customScenarios = [];
/** @type {Map<string, Scenario>} */
let scenarioById = new Map();

function rebuildIndex() {
  scenarioById = new Map([...BUILTIN_SCENARIOS, ...customScenarios].map((s) => [s.id, s]));
}

rebuildIndex();

function customSearchesDir(projectRoot) {
  return path.join(projectRoot, "custom-searches");
}

function legacyRegionToFields(region) {
  const normalized = String(region || "").toLowerCase();
  if (normalized === "canada") return { country: "Canada", city: "" };
  if (normalized === "quebec") return { country: "Canada", city: "Québec" };
  return { country: "", city: "" };
}

export function normalizeSearchParams(raw) {
  const urlInput = String(raw?.url || "").trim();
  if (urlInput && isLinkedInJobsSearchUrl(urlInput)) {
    try {
      const parsed = parseLinkedInSearchUrl(urlInput);
      return {
        keywords: parsed.keywords,
        days: parsed.days,
        workType: parsed.workType,
        country: parsed.country,
        city: parsed.city,
      };
    } catch {
      /* fall through to legacy fields */
    }
  }

  const keywords = String(raw?.keywords || "").trim();
  const daysRaw = Number(raw?.days);
  const days = [1, 2, 7].includes(daysRaw) ? daysRaw : 1;
  const workType = String(raw?.workType || "any").toLowerCase();
  const allowedWorkTypes = new Set(["remote", "hybrid", "onsite", "any"]);
  const normalizedWorkType = allowedWorkTypes.has(workType) ? workType : "any";
  let country = String(raw?.country || "").trim();
  let city = String(raw?.city || "").trim();
  if (!country && !city && raw?.region) {
    const legacy = legacyRegionToFields(raw.region);
    country = legacy.country;
    city = legacy.city;
  }
  return { keywords, days, workType: normalizedWorkType, country, city };
}

export function buildScenarioDescription({ keywords, country, city, workType, days }) {
  const locationLabel = formatSearchLocation({ country, city }) || "…";
  const workLabel = WORK_TYPE_DESC[workType] || workType;
  const periodLabel = DAYS_DESC[days] || `последние ${days} дн.`;
  return `LinkedIn: ${keywords}, ${locationLabel}, ${workLabel}. Вакансии за ${periodLabel}. Полный сбор → Ollama → обновление списка.`;
}

export function buildScenarioTitle({ keywords, country, city, workType, days }) {
  const locationLabel = formatSearchLocation({ country, city }) || "…";
  const workLabel = WORK_TYPE_TITLE[workType] || workType;
  const daysLabel = DAYS_TITLE[days] || `${days} дн.`;
  return `${keywords} — ${locationLabel}, ${workLabel}, ${daysLabel}`;
}

function applyCustomDisplayTitle(built, raw) {
  const customTitle = String(raw?.title || "").trim();
  if (!customTitle) {
    return built;
  }
  return { ...built, title: customTitle };
}

export function buildScenarioFromParams(raw) {
  const urlInput = String(raw?.url || "").trim();
  if (urlInput) {
    if (!isLinkedInJobsSearchUrl(urlInput)) {
      throw new Error("invalid LinkedIn search url");
    }
    const parsed = parseLinkedInSearchUrl(urlInput);
    const keywords =
      parsed.keywords ||
      formatSearchLocation(parsed) ||
      (parsed.geoId ? `geo:${parsed.geoId}` : "") ||
      "LinkedIn search";
    const withKeywords = { ...parsed, keywords };
    const title = buildScenarioTitle(withKeywords);
    const description = buildScenarioDescription(withKeywords);
    return applyCustomDisplayTitle({ ...withKeywords, title, description }, raw);
  }

  const params = normalizeSearchParams(raw);
  if (!params.keywords) {
    throw new Error("keywords required");
  }
  const url = buildLinkedInSearchUrl(params);
  const title = buildScenarioTitle(params);
  const description = buildScenarioDescription(params);
  return applyCustomDisplayTitle({ ...params, url, title, description }, raw);
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function makeScenarioId(params, projectRoot) {
  let locationSlug = slugify(formatSearchLocation(params)) || "anywhere";
  if (params.url) {
    try {
      const u = new URL(canonicalizeLinkedInJobsSearchUrl(params.url) || params.url);
      const geo = u.searchParams.get("geoId") || slugify(u.searchParams.get("location") || "") || "anywhere";
      const wt = u.searchParams.get("f_WT") || "any";
      const tpr = u.searchParams.get("f_TPR") || "any";
      locationSlug = `${geo}-${wt}-${tpr}`.replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-");
    } catch {
      /* keep locationSlug */
    }
  }
  const keywordSlug = slugify(params.keywords) || "jobs";
  const base = `${keywordSlug}-${locationSlug}-${params.workType}-${params.days}d`;
  let id = base || `search-${Date.now()}`;
  let n = 2;
  while (scenarioById.has(id) || fs.existsSync(path.join(customSearchesDir(projectRoot), `${id}.json`))) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

function parseLastRunStats(raw) {
  const stats = raw?.lastRunStats;
  if (!stats || typeof stats !== "object") {
    return undefined;
  }
  const found = Number(stats.found);
  const added = Number(stats.added);
  const skipped = Number(stats.skipped);
  const totalSeen = Number(stats.totalSeen ?? stats.linkedinTotal);
  const at = String(stats.at || "").trim();
  if (!Number.isFinite(found) && !Number.isFinite(added) && !Number.isFinite(totalSeen)) {
    return undefined;
  }
  const result = {
    found: Number.isFinite(found) && found >= 0 ? Math.round(found) : 0,
    added: Number.isFinite(added) && added >= 0 ? Math.round(added) : 0,
    at: at || undefined,
  };
  if (Number.isFinite(skipped) && skipped >= 0) {
    result.skipped = Math.round(skipped);
  } else if (result.found >= result.added) {
    result.skipped = result.found - result.added;
  }
  if (Number.isFinite(totalSeen) && totalSeen >= 0) {
    result.totalSeen = Math.round(totalSeen);
  }
  return result;
}

function parseScenarioFile(raw, fileStem) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const id = String(raw.id || fileStem || "").trim();
  if (!id) {
    return null;
  }

  if (raw.keywords && raw.url) {
    const params = normalizeSearchParams(raw);
    return {
      id,
      title: String(raw.title || raw.name || buildScenarioTitle(params)).trim(),
      description: String(raw.description || buildScenarioDescription(params)).trim(),
      url: String(raw.url).trim(),
      keywords: params.keywords,
      days: params.days,
      workType: params.workType,
      country: params.country,
      city: params.city,
      lastRunStats: parseLastRunStats(raw),
    };
  }

  const url = String(raw.url || "").trim();
  if (!url) {
    return null;
  }
  let keywords = "";
  try {
    keywords = decodeURIComponent(new URL(url).searchParams.get("keywords") || "").trim();
  } catch {
    /* ignore */
  }
  const params = normalizeSearchParams({
    keywords: keywords || String(raw.name || id).trim(),
    days: raw.days,
    workType: raw.workType,
    country: raw.country,
    city: raw.city,
    region: raw.region,
  });
  return {
    id,
    title: String(raw.title || raw.name || buildScenarioTitle(params)).trim(),
    description: String(raw.description || buildScenarioDescription(params)).trim(),
    url,
    keywords: params.keywords,
    days: params.days,
    workType: params.workType,
    country: params.country,
    city: params.city,
    lastRunStats: parseLastRunStats(raw),
  };
}

export function reloadCustomScenarios(projectRoot) {
  const dir = customSearchesDir(projectRoot);
  if (!fs.existsSync(dir)) {
    customScenarios = [];
    rebuildIndex();
    return customScenarios;
  }

  const next = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const filePath = path.join(dir, name);
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const scenario = parseScenarioFile(raw, name.replace(/\.json$/i, ""));
      if (scenario) {
        next.push(scenario);
      }
    } catch {
      /* skip invalid file */
    }
  }

  next.sort((a, b) => a.title.localeCompare(b.title, "ru"));
  customScenarios = next;
  rebuildIndex();
  return customScenarios;
}

export function getScenario(id) {
  return scenarioById.get(id) || null;
}

const BUILTIN_IDS = new Set(BUILTIN_SCENARIOS.map((s) => s.id));

export function isBuiltinScenario(id) {
  return BUILTIN_IDS.has(id);
}

export function listScenariosForApi() {
  return [...BUILTIN_SCENARIOS, ...customScenarios].map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    builtin: isBuiltinScenario(s.id),
    keywords: s.keywords,
    days: s.days,
    workType: s.workType,
    country: s.country,
    city: s.city,
    url: s.url,
    lastRunStats: s.lastRunStats,
  }));
}

/**
 * @param {string} projectRoot
 * @param {{ keywords?: string, days?: number, workType?: string, country?: string, city?: string, region?: string }} raw
 */
export function saveCustomScenario(projectRoot, raw) {
  const built = buildScenarioFromParams(raw);
  const id = makeScenarioId(built, projectRoot);
  /** @type {Scenario} */
  const scenario = { id, ...built };

  const dir = customSearchesDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.json`);
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        id: scenario.id,
        title: scenario.title,
        description: scenario.description,
        url: scenario.url,
        keywords: scenario.keywords,
        days: scenario.days,
        workType: scenario.workType,
        country: scenario.country,
        city: scenario.city,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  reloadCustomScenarios(projectRoot);
  return scenario;
}

/**
 * @param {string} projectRoot
 * @param {string} id
 */
export function deleteCustomScenario(projectRoot, id) {
  const scenarioId = String(id || "").trim();
  if (!scenarioId) {
    throw new Error("id required");
  }
  if (isBuiltinScenario(scenarioId)) {
    throw new Error("builtin scenario");
  }
  const filePath = path.join(customSearchesDir(projectRoot), `${scenarioId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error("not found");
  }
  fs.unlinkSync(filePath);
  reloadCustomScenarios(projectRoot);
}

/**
 * @param {string} projectRoot
 * @param {string} id
 * @param {{ keywords?: string, days?: number, workType?: string, country?: string, city?: string, region?: string }} raw
 */
export function updateCustomScenario(projectRoot, id, raw) {
  const scenarioId = String(id || "").trim();
  if (!scenarioId) {
    throw new Error("id required");
  }
  if (isBuiltinScenario(scenarioId)) {
    throw new Error("builtin scenario");
  }
  const filePath = path.join(customSearchesDir(projectRoot), `${scenarioId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error("not found");
  }
  const built = buildScenarioFromParams(raw);
  /** @type {Scenario} */
  const scenario = { id: scenarioId, ...built };
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        id: scenario.id,
        title: scenario.title,
        description: scenario.description,
        url: scenario.url,
        keywords: scenario.keywords,
        days: scenario.days,
        workType: scenario.workType,
        country: scenario.country,
        city: scenario.city,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  reloadCustomScenarios(projectRoot);
  return scenario;
}

/**
 * @param {string} projectRoot
 * @param {string} id
 * @param {string} title
 */
export function renameCustomScenario(projectRoot, id, title) {
  const scenarioId = String(id || "").trim();
  const newTitle = String(title || "").trim();
  if (!scenarioId) {
    throw new Error("id required");
  }
  if (!newTitle) {
    throw new Error("title required");
  }
  if (isBuiltinScenario(scenarioId)) {
    throw new Error("builtin scenario");
  }
  const filePath = path.join(customSearchesDir(projectRoot), `${scenarioId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error("not found");
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  raw.title = newTitle;
  fs.writeFileSync(filePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  reloadCustomScenarios(projectRoot);
  const scenario = getScenario(scenarioId);
  if (!scenario) {
    throw new Error("not found");
  }
  return scenario;
}
