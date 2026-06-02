import fs from "node:fs";
import path from "node:path";
import { canonicalizeLinkedInJobsSearchUrl } from "./linkedin-search-url.js";

const PENDING_FILE = ".scenario-run-pending.json";

function pendingPath(projectRoot) {
  return path.join(projectRoot, "reports", PENDING_FILE);
}

export function resolveScenarioIdFromEnv() {
  return String(process.env.DASHBOARD_SCENARIO_ID || "").trim();
}

function readPending(projectRoot) {
  const filePath = pendingPath(projectRoot);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object") {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function writePending(projectRoot, data) {
  const filePath = pendingPath(projectRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function clearPending(projectRoot) {
  const filePath = pendingPath(projectRoot);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function jobKeyFromLink(link) {
  const raw = String(link || "").trim();
  if (!raw || raw === "not found") {
    return "";
  }
  try {
    const u = new URL(raw, "https://www.linkedin.com");
    const match = u.pathname.match(/\/jobs\/view\/(\d+)/i);
    if (match) {
      return match[1];
    }
    const jk = u.searchParams.get("jk");
    if (jk) {
      return jk;
    }
    return u.toString().trim();
  } catch {
    return raw;
  }
}

function normalizeTotalSeen(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.round(n);
}

function parseRawFileJobStats(content, existingKeys) {
  const searchUrl = content.match(/^Search URL:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const totalSeenRaw =
    content.match(/^Total seen on search:\s*(\d+)/m)?.[1]
    ?? content.match(/^LinkedIn total on site:\s*(\d+)/m)?.[1]
    ?? "";
  const totalSeen = normalizeTotalSeen(totalSeenRaw);
  const skippedRaw = content.match(/^Skipped existing:\s*(\d+)/m)?.[1] ?? "";
  const skippedFromFile = normalizeTotalSeen(skippedRaw);
  const found = (content.match(/^###\s+\d+\.\s+/gm) || []).length;
  let added = 0;
  for (const match of content.matchAll(/^Link:\s*(.+)$/gm)) {
    const key = jobKeyFromLink(match[1]);
    if (key && !existingKeys.has(key)) {
      added += 1;
    }
  }
  const skippedFromAdded = Math.max(0, found - added);
  const skipped = skippedFromFile !== null ? skippedFromFile : skippedFromAdded;
  return { searchUrl, found, added, totalSeen, skipped };
}

function loadScenarioUrlToId(projectRoot) {
  const dir = path.join(projectRoot, "custom-searches");
  const map = new Map();
  if (!fs.existsSync(dir)) {
    return map;
  }
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      const id = String(raw.id || name.replace(/\.json$/i, "")).trim();
      const url = canonicalizeLinkedInJobsSearchUrl(String(raw.url || "").trim());
      if (id && url) {
        map.set(url, id);
      }
    } catch {
      /* skip */
    }
  }
  return map;
}

function resolveScenarioIdForSearchUrl(urlToId, searchUrl) {
  const canonical = canonicalizeLinkedInJobsSearchUrl(searchUrl);
  if (!canonical) {
    return "";
  }
  return urlToId.get(canonical) || "";
}

export function listSessionRawReportNames(reportsDir, sessionStartMs) {
  return listSessionRawFiles(reportsDir, sessionStartMs);
}

function listSessionRawFiles(reportsDir, sessionStartMs) {
  if (!sessionStartMs || !fs.existsSync(reportsDir)) {
    return [];
  }
  return fs
    .readdirSync(reportsDir)
    .filter((name) => name.endsWith("-raw.md"))
    .filter((name) => {
      try {
        return fs.statSync(path.join(reportsDir, name)).mtimeMs >= sessionStartMs;
      } catch {
        return false;
      }
    });
}

/** @param {string} projectRoot @param {number} found @param {number|null} totalSeen @param {number|null} skipped */
export function recordScrapeFoundCount(projectRoot, found, totalSeen = null, skipped = null) {
  const scenarioId = resolveScenarioIdFromEnv();
  if (!scenarioId || scenarioId.startsWith("custom-")) {
    return;
  }
  const count = Number.isFinite(found) && found >= 0 ? Math.round(found) : 0;
  const pending = readPending(projectRoot);
  const total = normalizeTotalSeen(totalSeen);
  const skippedCount = normalizeTotalSeen(skipped);
  writePending(projectRoot, {
    scenarioId,
    found: count,
    totalSeen: total ?? (pending?.scenarioId === scenarioId ? pending.totalSeen : undefined),
    skipped: skippedCount ?? (pending?.scenarioId === scenarioId ? pending.skipped : undefined),
    added: pending?.scenarioId === scenarioId ? pending.added : undefined,
    updatedAt: new Date().toISOString(),
  });
}

/** @param {string} projectRoot @param {number} added */
export function recordPreprocessAddedCount(projectRoot, added) {
  const scenarioId = resolveScenarioIdFromEnv();
  if (!scenarioId || scenarioId.startsWith("custom-")) {
    return;
  }
  const count = Number.isFinite(added) && added >= 0 ? Math.round(added) : 0;
  const pending = readPending(projectRoot);
  writePending(projectRoot, {
    scenarioId,
    found: pending?.scenarioId === scenarioId ? pending.found : undefined,
    totalSeen: pending?.scenarioId === scenarioId ? pending.totalSeen : undefined,
    skipped: pending?.scenarioId === scenarioId ? pending.skipped : undefined,
    added: count,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * @param {string} projectRoot
 * @param {string} scenarioId
 * @param {{ found?: number, added?: number, skipped?: number|null, totalSeen?: number|null }} stats
 */
export function updateScenarioLastRunStats(projectRoot, scenarioId, stats) {
  const id = String(scenarioId || "").trim();
  if (!id || id.startsWith("custom-")) {
    return false;
  }

  const filePath = path.join(projectRoot, "custom-searches", `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return false;
  }

  const found = Number.isFinite(stats.found) && stats.found >= 0 ? Math.round(stats.found) : 0;
  const added = Number.isFinite(stats.added) && stats.added >= 0 ? Math.round(stats.added) : 0;
  const prev = raw.lastRunStats && typeof raw.lastRunStats === "object" ? raw.lastRunStats : {};
  let skipped = normalizeTotalSeen(prev.skipped);
  if (stats.skipped !== undefined) {
    const nextSkipped = normalizeTotalSeen(stats.skipped);
    if (nextSkipped !== null) {
      skipped = nextSkipped;
    }
  } else if (skipped === null && found >= added) {
    skipped = found - added;
  }
  let totalSeen = normalizeTotalSeen(prev.totalSeen ?? prev.linkedinTotal);
  if (stats.totalSeen !== undefined) {
    const nextTotal = normalizeTotalSeen(stats.totalSeen);
    if (nextTotal !== null) {
      totalSeen = nextTotal;
    }
  }

  raw.lastRunStats = {
    found,
    added,
    at: new Date().toISOString(),
  };
  if (skipped !== null) {
    raw.lastRunStats.skipped = skipped;
  }
  if (totalSeen !== null) {
    raw.lastRunStats.totalSeen = totalSeen;
  }

  fs.writeFileSync(filePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return true;
}

/** Save "found" right after LinkedIn scrape (Run all runs scrape without --live). */
export function commitScrapeStats(projectRoot, scenarioId) {
  const id = String(scenarioId || "").trim();
  if (!id || id.startsWith("custom-")) {
    return false;
  }

  const pending = readPending(projectRoot);
  const found =
    pending?.scenarioId === id && Number.isFinite(pending.found) ? Math.round(pending.found) : null;
  if (found === null) {
    return false;
  }

  let previousAdded = 0;
  let previousSkipped = null;
  const filePath = path.join(projectRoot, "custom-searches", `${id}.json`);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const prev = raw?.lastRunStats;
    if (Number.isFinite(prev?.added) && prev.added >= 0) {
      previousAdded = Math.round(prev.added);
    }
    previousSkipped = normalizeTotalSeen(prev?.skipped);
  } catch {
    /* ignore */
  }

  const totalSeen =
    pending?.scenarioId === id ? normalizeTotalSeen(pending.totalSeen) : null;
  const skipped =
    pending?.scenarioId === id ? normalizeTotalSeen(pending.skipped) : previousSkipped;
  updateScenarioLastRunStats(projectRoot, id, {
    found,
    added: previousAdded,
    skipped,
    totalSeen,
  });
  return true;
}

/**
 * After Run all preprocess: attribute found/added per search from session raw reports.
 * @param {string} projectRoot
 * @param {string} reportsDir
 * @param {number} sessionStartMs
 * @param {Set<string>} existingKeys job keys already in dashboard before this batch
 * @param {string[]} [rawFileNames] optional explicit list (defaults to session mtime filter)
 */
export function persistBatchScenarioRunStats(
  projectRoot,
  reportsDir,
  sessionStartMs,
  existingKeys,
  rawFileNames,
) {
  if (!sessionStartMs) {
    return 0;
  }

  const files = rawFileNames?.length
    ? rawFileNames
    : listSessionRawFiles(reportsDir, sessionStartMs);
  if (!files.length) {
    return 0;
  }

  const urlToId = loadScenarioUrlToId(projectRoot);
  let updated = 0;

  for (const fileName of files) {
    const filePath = path.join(reportsDir, fileName);
    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const { searchUrl, found, added, totalSeen, skipped } = parseRawFileJobStats(content, existingKeys);
    const scenarioId = resolveScenarioIdForSearchUrl(urlToId, searchUrl);
    if (!scenarioId) {
      continue;
    }

    if (updateScenarioLastRunStats(projectRoot, scenarioId, {
      found,
      added,
      skipped,
      ...(totalSeen !== null ? { totalSeen } : {}),
    })) {
      updated += 1;
      for (const match of content.matchAll(/^Link:\s*(.+)$/gm)) {
        const key = jobKeyFromLink(match[1]);
        if (key) {
          existingKeys.add(key);
        }
      }
    }
  }

  return updated;
}

/**
 * Backfill lastRunStats from raw reports already on disk (e.g. after a Run all before stats were saved).
 * @param {string} projectRoot
 * @param {number} sessionStartMs minimum mtime for *-raw.md to include
 */
export function backfillScenarioRunStatsFromSession(projectRoot, sessionStartMs) {
  const reportsDir = path.join(projectRoot, "reports");
  const dashboardPath = path.join(reportsDir, "dashboard-jobs.json");
  let jobs = [];
  try {
    const dash = JSON.parse(fs.readFileSync(dashboardPath, "utf8"));
    jobs = Array.isArray(dash.jobs) ? dash.jobs : [];
  } catch {
    jobs = [];
  }

  const files = listSessionRawReportNames(reportsDir, sessionStartMs);
  const urlToId = loadScenarioUrlToId(projectRoot);
  let updated = 0;

  for (const fileName of files) {
    const filePath = path.join(reportsDir, fileName);
    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const { searchUrl, found, totalSeen, skipped } = parseRawFileJobStats(content, new Set());
    const scenarioId = resolveScenarioIdForSearchUrl(urlToId, searchUrl);
    if (!scenarioId) {
      continue;
    }

    const added = jobs.filter((job) => {
      const source = String(job.source_file || job.raw_report_path || "").trim();
      if (!source) {
        return false;
      }
      const base = source.replace(/^reports[/\\]/i, "").replace(/\\/g, "/");
      return base === fileName || base.endsWith(`/${fileName}`);
    }).length;

    if (updateScenarioLastRunStats(projectRoot, scenarioId, {
      found,
      added,
      skipped,
      ...(totalSeen !== null ? { totalSeen } : {}),
    })) {
      updated += 1;
    }
  }

  return updated;
}

/** @param {string} projectRoot @param {string} [scenarioIdOverride] */
export function persistScenarioRunStats(projectRoot, scenarioIdOverride) {
  const scenarioId = String(scenarioIdOverride || resolveScenarioIdFromEnv() || "").trim();
  if (!scenarioId || scenarioId.startsWith("custom-")) {
    clearPending(projectRoot);
    return false;
  }

  const pending = readPending(projectRoot);
  if (!pending || pending.scenarioId !== scenarioId) {
    clearPending(projectRoot);
    return false;
  }

  let found = Number.isFinite(pending.found) ? pending.found : null;
  let added = Number.isFinite(pending.added) ? pending.added : null;
  let skipped = normalizeTotalSeen(pending.skipped);
  let totalSeen = normalizeTotalSeen(pending.totalSeen);

  const filePath = path.join(projectRoot, "custom-searches", `${scenarioId}.json`);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const prev = raw?.lastRunStats;
    if (found === null && Number.isFinite(prev?.found)) {
      found = Math.round(prev.found);
    }
    if (added === null && Number.isFinite(prev?.added)) {
      added = Math.round(prev.added);
    }
    if (skipped === null) {
      skipped = normalizeTotalSeen(prev?.skipped);
    }
    if (totalSeen === null) {
      totalSeen = normalizeTotalSeen(prev?.totalSeen ?? prev?.linkedinTotal);
    }
  } catch {
    /* ignore */
  }

  const ok = updateScenarioLastRunStats(projectRoot, scenarioId, {
    found: found ?? 0,
    added: added ?? 0,
    skipped,
    totalSeen,
  });
  clearPending(projectRoot);
  return ok;
}
