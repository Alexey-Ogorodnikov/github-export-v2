import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeDashboardSnapshot } from "./dashboard-db.js";
import {
  listSessionRawReportNames,
  persistBatchScenarioRunStats,
  recordPreprocessAddedCount,
  resolveScenarioIdFromEnv,
} from "./scenario-run-stats.js";
import { ensureWinConsoleUtf8 } from "./win-console-utf8.js";

ensureWinConsoleUtf8();

let preprocessWall0 = Date.now();

function preprocessResetWallClock() {
  preprocessWall0 = Date.now();
}

function preprocessElapsedSec() {
  return ((Date.now() - preprocessWall0) / 1000).toFixed(1);
}

function preprocessLog(message) {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[preprocess ${stamp} +${preprocessElapsedSec()}s] ${message}`);
}

/** @param {number[]} recentJobTotalMs ring buffer newest last */
function formatEtaLine(remaining, recentJobTotalMs) {
  if (remaining <= 0 || recentJobTotalMs.length === 0) return "";
  const avg = recentJobTotalMs.reduce((a, b) => a + b, 0) / recentJobTotalMs.length;
  const etaSec = Math.round((remaining * avg) / 1000);
  return ` | ETA ~${etaSec}s`;
}

let ollamaComputePlacementLogged = false;

function formatMiB(bytes) {
  const n = Number(bytes || 0);
  if (!(n > 0)) return "0MiB";
  return `${(n / (1024 * 1024)).toFixed(0)}MiB`;
}

/** Один раз после первого успешного /api/generate: GET /api/ps (size vs size_vram) — грубая оценка GPU vs CPU/RAM. */
async function logOllamaComputePlacementOnce(hostBase) {
  if (ollamaComputePlacementLogged) return;
  ollamaComputePlacementLogged = true;

  const base = hostBase;
  try {
    const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined;
    const res = await fetch(`${base}/api/ps`, signal ? { signal } : {});
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models : [];
    if (models.length === 0) {
      preprocessLog(
        "Ollama /api/ps empty: no loaded model visible. Check manually: ollama ps (PROCESSOR column).",
      );
      return;
    }

    for (const m of models) {
      const name = String(m.name || m.model || "?");
      const size = Number(m.size || 0);
      const vram = Number(m.size_vram || 0);
      if (size <= 0) {
        preprocessLog(`Ollama "${name}": no size in /api/ps — cannot estimate GPU/CPU.`);
        continue;
      }
      const gpuPct = Math.min(100, Math.max(0, Math.round((100 * vram) / size)));
      const restPct = Math.min(100, 100 - gpuPct);
      let hint = "mixed: part of weights in VRAM (GPU), part in RAM/host";
      if (gpuPct >= 85) hint = "mostly on GPU (VRAM)";
      else if (gpuPct <= 10) hint = "almost all weights outside VRAM — typically CPU / host RAM";

      preprocessLog(
        `Ollama compute placement (from /api/ps): "${name}" — ${gpuPct}% of weights in VRAM ${formatMiB(vram)} of ${formatMiB(size)} (${hint}); ~${restPct}% outside VRAM. Details: ollama ps → PROCESSOR.`,
      );
    }
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    preprocessLog(
      `Ollama compute placement: failed to query ${base}/api/ps (${msg}). Try: ollama ps`,
    );
  }
}

const CARD_NOISE_LINE = /^(viewed|easy apply|promoted|actively hiring)$/i;

function isLocationLine(line) {
  const l = String(line || "").trim();
  if (!l) {
    return false;
  }
  return (
    /\((Remote|Hybrid|On[-\s]?site|Onsite)\)/i.test(l) ||
    /,\s*[A-Za-z]{2,}(\s*\(|$)/.test(l) ||
    /\b(remote|hybrid|on[-\s]?site|onsite|in office|in-office)\b/i.test(l)
  );
}

function shouldReplaceCompany(currentCompany, nextCompany) {
  const current = String(currentCompany || "").trim();
  const next = String(nextCompany || "").trim();
  if (!next) {
    return false;
  }
  if (!current) {
    return true;
  }
  if (current === next) {
    return false;
  }
  if (isLocationLine(current)) {
    return true;
  }
  if (CARD_NOISE_LINE.test(current)) {
    return true;
  }
  return false;
}

function extractCompanyFromDescription(fullDescription) {
  const text = String(fullDescription || "").slice(0, 2500);
  const postedBy = /\bposted by\s+([^,\n]+?)\s+on behalf of\b/i.exec(text);
  if (postedBy?.[1]) {
    return postedBy[1].trim();
  }
  return "";
}

function extractCompanyAndLocationFromCard(cardLines, title, fullDescription = "") {
  const normalizedTitle = String(title || "").trim().toLowerCase();

  const meaningful = cardLines.filter((line) => {
    const l = line.trim();
    if (!l) {
      return false;
    }
    if (CARD_NOISE_LINE.test(l)) {
      return false;
    }
    if (l.toLowerCase() === normalizedTitle) {
      return false;
    }
    if (l.toLowerCase().startsWith(normalizedTitle) && /with verification/i.test(l)) {
      return false;
    }
    return true;
  });

  const locationIdx = meaningful.findIndex((line) => isLocationLine(line));
  if (locationIdx > 0) {
    return {
      company: meaningful[locationIdx - 1],
      locationLine: meaningful[locationIdx],
    };
  }

  if (meaningful.length >= 2) {
    const last = meaningful[meaningful.length - 1];
    const prev = meaningful[meaningful.length - 2];
    if (isLocationLine(last)) {
      return { company: prev, locationLine: last };
    }
    return { company: prev, locationLine: last };
  }

  if (meaningful.length === 1) {
    if (isLocationLine(meaningful[0])) {
      return {
        company: extractCompanyFromDescription(fullDescription),
        locationLine: meaningful[0],
      };
    }
    return { company: meaningful[0], locationLine: "" };
  }

  return {
    company: extractCompanyFromDescription(fullDescription),
    locationLine: "",
  };
}

const projectRoot = process.cwd();
const reportsDir = path.join(projectRoot, "reports");
const today = getTodayLocalDateString();
const outputPath = path.join(reportsDir, "dashboard-jobs.json");
const legacyOutputPath = path.join(reportsDir, "today-jobs.json");

const rawFiles = await listAllRawReportFiles(reportsDir);

if (rawFiles.length === 0) {
  throw new Error("No *-raw.md reports found in reports/.");
}

const rebuild = isTruthyEnv(process.env.PREPROCESS_REBUILD);
if (rebuild) {
  preprocessResetWallClock();
  const ollamaModel = process.env.OLLAMA_MODEL || "llama3.2:3b";
  const ollamaHost = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  preprocessLog(`Full rebuild (PREPROCESS_REBUILD=1), raw files: ${rawFiles.length}`);
  preprocessLog(`Ollama: ${ollamaHost}, model: ${ollamaModel} (keep this window open — work in progress)`);
  preprocessLog(
    "After the first model response you will see an Ollama compute placement line (GET /api/ps, size / size_vram).",
  );
  preprocessLog("If one step hangs for minutes — watch the latest job N/M line below.");

  preprocessLog("Phase: reading *-raw.md and deduplicating…");
  const allJobs = [];
  for (const fileName of rawFiles) {
    const filePath = path.join(reportsDir, fileName);
    const content = await readFile(filePath, "utf8");
    allJobs.push(...extractJobsFromRaw(content, fileName));
  }
  const uniqueJobs = dedupeJobsByLink(allJobs);
  preprocessLog(
    `Dedup: ${uniqueJobs.length} unique jobs (from ${allJobs.length} fragments). 2x Ollama per job.`,
  );

  const recentTotals = [];

  for (let i = 0; i < uniqueJobs.length; i += 1) {
    const job = uniqueJobs[i];
    if (Array.isArray(job.verification_sources) && job.verification_sources.length > 1) {
      job.verification_sources = [job.verification_sources[0]];
    }
    await preprocessOllamaForOneJob(job, i + 1, uniqueJobs.length, recentTotals, "rebuild");
  }

  preprocessLog("Phase: writing dashboard-jobs.json and DB snapshot…");
  const output = {
    generated_at: new Date().toISOString(),
    aggregate: "all-raw-reports",
    generated_on_date: today,
    reports_processed: [...rawFiles].sort(),
    jobs_count: uniqueJobs.length,
    jobs: uniqueJobs,
  };
  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  writeDashboardSnapshot(output, projectRoot);
  console.log(
    `Full rebuild from ${rawFiles.length} raw file(s) (recursive in reports/, pattern *-raw.md), jobs after dedup: ${uniqueJobs.length}.`,
  );
  console.log("Per job: 2 Ollama requests (short summary + AI classification).");
  console.log(`Output: ${path.relative(projectRoot, outputPath)}`);
  preprocessLog(`Done in ${preprocessElapsedSec()}s wall time.`);
  process.exit(0);
}

let previous = null;
try {
  const prevText = await readFile(outputPath, "utf8");
  previous = JSON.parse(prevText);
} catch {
  previous = null;
}
if (!previous) {
  try {
    const legacyText = await readFile(legacyOutputPath, "utf8");
    previous = JSON.parse(legacyText);
  } catch {
    previous = null;
  }
}

const canResume =
  previous &&
  Array.isArray(previous.jobs) &&
  Array.isArray(previous.reports_processed);

const processedSet = canResume ? new Set(previous.reports_processed) : new Set();
const sessionStartMs = Number.parseInt(process.env.PREPROCESS_SESSION_START_MS || "0", 10) || 0;
const rawFilesToProcess = await resolveRawFilesToProcess(
  rawFiles,
  processedSet,
  reportsDir,
  sessionStartMs,
);

if (canResume && rawFilesToProcess.length === 0) {
  const orphans = [...processedSet].filter((name) => !rawFiles.includes(name));
  if (orphans.length > 0) {
    console.log(
      `Note: dashboard-jobs.json (reports_processed) lists ${orphans.length} file name(s) missing from reports/ (old runs).`,
    );
  }
  const postedByKey = await buildPostedByJobKeyFromRawFiles(rawFiles, reportsDir);
  const aiQuoteByKey = await buildAiQuoteByJobKeyFromRawFiles(rawFiles, reportsDir);
  let changed = false;
  let jobs = previous.jobs.map((job) => {
    let next = { ...job };
    const k = jobKey(next);
    const fromRaw = k && postedByKey.get(k);
    if (fromRaw) {
      const beforeD = next.posted_days_ago;
      const beforeT = next.posted_text;
      mergePostedPreferRecent(next, fromRaw);
      if (next.posted_days_ago !== beforeD || next.posted_text !== beforeT) {
        changed = true;
      }
      if (shouldReplaceCompany(next.company, fromRaw.company)) {
        next.company = fromRaw.company;
        changed = true;
      }
      if (fromRaw.location && next.location !== fromRaw.location) {
        next.location = fromRaw.location;
        next.work_type = fromRaw.work_type || detectWorkType(fromRaw.location || next.location);
        changed = true;
      }
    }
    const fromAiQuote = k && aiQuoteByKey.get(k);
    if (fromAiQuote && String(next.ai_report_quote || "").trim() !== fromAiQuote) {
      next.ai_report_quote = fromAiQuote;
      changed = true;
    }
    if (Array.isArray(next.verification_sources) && next.verification_sources.length > 1) {
      next = { ...next, verification_sources: [next.verification_sources[0]] };
      changed = true;
    }
    return next;
  });

  if (isTruthyEnv(process.env.PREPROCESS_AI_BACKFILL)) {
    preprocessResetWallClock();
    const out = [];
    const needBackfill = jobs.filter((j) => !["yes", "no", "maybe"].includes(j.ai_verdict));
    preprocessLog(
      `PREPROCESS_AI_BACKFILL: Ollama re-classify for ${needBackfill.length} jobs (no verdict yet, of ${jobs.length} total).`,
    );
    const recentBf = [];
    let bfDone = 0;
    for (const job of jobs) {
      if (["yes", "no", "maybe"].includes(job.ai_verdict)) {
        out.push(job);
        continue;
      }
      const label = String(job.title || "Untitled").replace(/\s+/g, " ").slice(0, 72);
      bfDone += 1;
      const t0 = Date.now();
      const ai = await classifyAiRoleWithOllama(job);
      const dt = Date.now() - t0;
      recentBf.push(dt);
      if (recentBf.length > 8) recentBf.shift();
      const eta = formatEtaLine(needBackfill.length - bfDone, recentBf);
      preprocessLog(
        `backfill ${bfDone}/${needBackfill.length} "${label}" | classify ${(dt / 1000).toFixed(1)}s${eta}`,
      );
      out.push({
        ...job,
        ...ai,
        ai_classified_at: new Date().toISOString(),
      });
      changed = true;
    }
    jobs = out;
  }

  if (changed) {
    const refreshedOutput = {
      ...previous,
      generated_at: new Date().toISOString(),
      jobs,
    };
    await writeFile(
      outputPath,
      JSON.stringify(refreshedOutput, null, 2),
      "utf8",
    );
    writeDashboardSnapshot(refreshedOutput, projectRoot);
    console.log("dashboard-jobs.json updated (posted dates / companies / sources).");
  } else {
    writeDashboardSnapshot(previous, projectRoot);
    console.log(
      `On disk in reports/: ${rawFiles.length} *-raw.md file(s); all already in dashboard-jobs.json (new for incremental: 0).`,
    );
    console.log(
      `reports_processed entries: ${processedSet.size}. This means no new raw files since the last run, not "no data".`,
    );
    console.log(`Full rebuild of all *-raw.md via Ollama: npm run preprocess:rebuild`);
  }
  recordPreprocessAddedCount(projectRoot, 0);
  if (sessionStartMs > 0 && !resolveScenarioIdFromEnv()) {
    const existingKeysEarly = new Set();
    for (const job of previous.jobs) {
      const k = jobKey(job);
      if (k) {
        existingKeysEarly.add(k);
      }
    }
    const sessionRaw = listSessionRawReportNames(reportsDir, sessionStartMs);
    persistBatchScenarioRunStats(
      projectRoot,
      reportsDir,
      sessionStartMs,
      existingKeysEarly,
      sessionRaw,
    );
  }
  console.log(`Output: ${path.relative(projectRoot, outputPath)}`);
  process.exit(0);
}

const existingJobs = canResume ? previous.jobs : [];
const existingByKey = new Map();
for (const job of existingJobs) {
  const key = jobKey(job);
  if (key) {
    existingByKey.set(key, job);
  }
}

preprocessResetWallClock();
const filesToScan = canResume ? rawFilesToProcess : rawFiles;
preprocessLog(
  canResume
    ? `Incremental: new *-raw.md to parse: ${filesToScan.length} (${rawFiles.length} on disk).`
    : `First pass: parsing all *-raw.md: ${filesToScan.length}.`,
);
preprocessLog(
  "After the first Ollama response you will see compute placement (GPU/CPU estimate from GET /api/ps).",
);

const allJobs = [];
for (const fileName of filesToScan) {
  const filePath = path.join(reportsDir, fileName);
  const content = await readFile(filePath, "utf8");
  const jobs = extractJobsFromRaw(content, fileName);
  allJobs.push(...jobs);
}

const uniqueFromBatch = dedupeJobsByLink(allJobs);
preprocessLog(`Extracted ${uniqueFromBatch.length} jobs from this batch (before merging with dashboard).`);

let uniqueJobs;
let addedThisRun = 0;
const recentTotalsIncremental = [];
if (canResume) {
  const appended = [];
  const backfill = [];
  for (const job of uniqueFromBatch) {
    const key = jobKey(job);
    if (!key) {
      continue;
    }
    const existing = existingByKey.get(key);
    if (!existing) {
      appended.push(job);
      continue;
    }
    mergePostedPreferRecent(existing, job);
    if (needsOllamaPreprocess(existing)) {
      backfill.push(existing);
    }
  }

  const ollamaQueue = [...appended, ...backfill];
  if (ollamaQueue.length === 0) {
    preprocessLog("No new jobs for Ollama (all already in dashboard and classified).");
  } else {
    const parts = [];
    if (appended.length > 0) {
      parts.push(`${appended.length} new`);
    }
    if (backfill.length > 0) {
      parts.push(`${backfill.length} unclassified`);
    }
    preprocessLog(`Ollama for ${ollamaQueue.length} job(s) (${parts.join(", ")}, 2 requests each)…`);
  }
  for (let i = 0; i < ollamaQueue.length; i += 1) {
    const tag = i < appended.length ? "incremental-new" : "incremental-backfill";
    await preprocessOllamaForOneJob(
      ollamaQueue[i],
      i + 1,
      ollamaQueue.length,
      recentTotalsIncremental,
      tag,
    );
  }
  addedThisRun = appended.length;
  uniqueJobs = [...existingJobs, ...appended];
} else {
  uniqueJobs = uniqueFromBatch;
  addedThisRun = uniqueFromBatch.length;
  preprocessLog(`Ollama for all ${uniqueJobs.length} jobs in first snapshot (2 requests each)…`);
  for (let i = 0; i < uniqueJobs.length; i += 1) {
    await preprocessOllamaForOneJob(
      uniqueJobs[i],
      i + 1,
      uniqueJobs.length,
      recentTotalsIncremental,
      "full",
    );
  }
}

const reportsProcessed = [...new Set([...(canResume ? previous.reports_processed : []), ...filesToScan])].sort();

for (const job of uniqueJobs) {
  if (Array.isArray(job.verification_sources) && job.verification_sources.length > 1) {
    job.verification_sources = [job.verification_sources[0]];
  }
}

const output = {
  generated_at: new Date().toISOString(),
  aggregate: "all-raw-reports",
  generated_on_date: today,
  reports_processed: reportsProcessed,
  jobs_count: uniqueJobs.length,
  jobs: uniqueJobs,
};

preprocessLog(
  `Writing result (${uniqueJobs.length} jobs) -> ${path.relative(projectRoot, outputPath)} and DB snapshot…`,
);
await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
writeDashboardSnapshot(output, projectRoot);

console.log(`Total raw files: ${rawFiles.length}`);
console.log(`Processed this run: ${filesToScan.length}`);
console.log(`Unique jobs: ${uniqueJobs.length}`);
console.log(`Output: ${path.relative(projectRoot, outputPath)}`);
if (resolveScenarioIdFromEnv()) {
  recordPreprocessAddedCount(projectRoot, addedThisRun);
} else if (sessionStartMs > 0) {
  const existingKeysBeforeBatch = new Set(existingByKey.keys());
  persistBatchScenarioRunStats(
    projectRoot,
    reportsDir,
    sessionStartMs,
    existingKeysBeforeBatch,
    filesToScan,
  );
}
preprocessLog(`Done in ${preprocessElapsedSec()}s wall time.`);

async function buildPostedByJobKeyFromRawFiles(rawFileNames, dir) {
  const all = [];
  for (const name of rawFileNames) {
    const content = await readFile(path.join(dir, name), "utf8");
    all.push(...extractJobsFromRaw(content, name));
  }
  const deduped = dedupeJobsByLink(all);
  const map = new Map();
  for (const j of deduped) {
    const k = jobKey(j);
    if (k) {
      map.set(k, j);
    }
  }
  return map;
}

async function buildAiQuoteByJobKeyFromRawFiles(rawFileNames, dir) {
  const all = [];
  for (const name of rawFileNames) {
    const content = await readFile(path.join(dir, name), "utf8");
    all.push(...extractJobsFromRaw(content, name));
  }
  const deduped = dedupeJobsByLink(all);
  const map = new Map();
  for (const j of deduped) {
    const k = jobKey(j);
    if (k) {
      map.set(k, String(j.ai_report_quote || "").trim());
    }
  }
  return map;
}

function getTodayLocalDateString() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function extractReportMeta(rawContent) {
  const seeAllJobsUrl = rawContent.match(/^Search URL:\s*(.+)$/m)?.[1]?.trim() ?? "";
  return {
    see_all_jobs_url: seeAllJobsUrl,
    page_title: rawContent.match(/^Page:\s*(.+)$/m)?.[1]?.trim() ?? "",
  };
}

function extractJobsFromRaw(rawContent, sourceFile) {
  const { see_all_jobs_url: seeAllJobsUrl, page_title: rawPageTitle } = extractReportMeta(rawContent);
  const matches = [...rawContent.matchAll(/^###\s+\d+\.\s+(.+)$/gm)];
  const jobs = [];

  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? rawContent.length) : rawContent.length;
    const section = rawContent.slice(start, end);

    const title = matches[i][1].trim();
    const link = section.match(/^Link:\s*(.+)$/m)?.[1]?.trim() ?? "";
    const jobCard = section.match(/Job card text:\s*```text([\s\S]*?)```/m)?.[1]?.trim() ?? "";
    const fullDescription = section.match(/Full description:\s*```text([\s\S]*?)```/m)?.[1]?.trim() ?? "";
    const aiReportQuote = extractAiMentionQuote(fullDescription);

    const cardLines = jobCard
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const { company, locationLine } = extractCompanyAndLocationFromCard(cardLines, title, fullDescription);

    const posted = extractPostedRecency(jobCard, fullDescription);

    jobs.push({
      source_file: sourceFile,
      raw_report_path_posix: `reports/${toReportsPosixPath(sourceFile)}`,
      see_all_jobs_url: seeAllJobsUrl,
      raw_page_title: rawPageTitle,
      title,
      company,
      work_type: detectWorkType(locationLine || fullDescription),
      location: locationLine,
      link,
      short_summary: "",
      ai_verdict: null,
      ai_keywords: [],
      ai_reason: "",
      ai_report_quote: aiReportQuote,
      // Salary often lives in the card snippet, not in Full description.
      job_card_text: jobCard.slice(0, 2000),
      // Long enough that duties/requirements bullets (often after company boilerplate) reach Ollama.
      description_preview: fullDescription.slice(0, 8000),
      posted_text: posted.posted_text,
      posted_days_ago: posted.posted_days_ago,
    });
  }

  return jobs;
}

function dedupeJobsByLink(jobs) {
  const byKey = new Map();

  for (const job of jobs) {
    const key = extractLinkedInJobId(job.link) || job.link;
    if (!key) {
      continue;
    }

    const sourceEntry = {
      raw_file: job.source_file,
      raw_report_path_posix: job.raw_report_path_posix,
      see_all_jobs_url: job.see_all_jobs_url || "",
      raw_page_title: job.raw_page_title || "",
    };

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...job,
        verification_sources: [sourceEntry],
      });
      continue;
    }

    mergePostedPreferRecent(existing, job);
  }

  return [...byKey.values()];
}

function mergePostedPreferRecent(existing, incoming) {
  const a = existing.posted_days_ago;
  const b = incoming.posted_days_ago;
  if (b != null && (a == null || b < a)) {
    existing.posted_days_ago = incoming.posted_days_ago;
    existing.posted_text = incoming.posted_text || existing.posted_text;
  }
}

function extractPostedRecency(jobCard, fullDescription) {
  const fromCard = extractPostedFromSnippet(jobCard);
  if (fromCard.posted_days_ago !== null) {
    return fromCard;
  }
  return extractPostedFromSnippet(String(fullDescription || "").slice(0, 1500));
}

function extractPostedFromSnippet(text) {
  const t = String(text || "");
  if (!t.trim()) {
    return { posted_text: "", posted_days_ago: null };
  }
  if (/\bjust\s+now\b/i.test(t)) {
    return { posted_text: "Just now", posted_days_ago: 0 };
  }
  if (/\byesterday\b/i.test(t)) {
    return { posted_text: "Yesterday", posted_days_ago: 1 };
  }

  const ru = t.match(
    /(\d+)\s*(дн\.|дня|дней|нед\.|недели|недель|мес\.|месяц|месяца|месяцев|ч\.|час|часа|часов)\s*назад/i,
  );
  if (ru) {
    const n = Number.parseInt(ru[1], 10);
    const u = ru[2].toLowerCase();
    let days = null;
    if (/^дн/.test(u)) {
      days = n;
    } else if (/^нед/.test(u)) {
      days = n * 7;
    } else if (/^мес|^месяц/.test(u)) {
      days = n * 30;
    } else if (/^ч/.test(u)) {
      days = 0;
    }
    if (days !== null) {
      return { posted_text: ru[0].trim(), posted_days_ago: days };
    }
  }

  const enPosted = /\b(?:Posted|Reposted)\s+(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago\b/i.exec(
    t,
  );
  if (enPosted) {
    const daysFromEn = postedDaysFromEnglishUnit(
      Number.parseInt(enPosted[1], 10),
      enPosted[2],
    );
    if (daysFromEn !== null) {
      return { posted_text: enPosted[0].trim(), posted_days_ago: daysFromEn };
    }
  }

  // Snippet-style "2 weeks ago" (no leading Posted). Exclude "year(s)" — job descriptions
  // often say "founded ... 30 years ago", which is not a LinkedIn posted date.
  const enSnippet = /\b(\d+)\s*(second|minute|hour|day|week|month)s?\s+ago\b/i.exec(t);
  if (enSnippet) {
    const daysFromSnippet = postedDaysFromEnglishUnit(
      Number.parseInt(enSnippet[1], 10),
      enSnippet[2],
    );
    if (daysFromSnippet !== null) {
      return { posted_text: enSnippet[0].trim(), posted_days_ago: daysFromSnippet };
    }
  }

  return { posted_text: "", posted_days_ago: null };
}

function postedDaysFromEnglishUnit(n, unitRaw) {
  const unit = String(unitRaw || "").toLowerCase();
  if (unit.startsWith("second") || unit.startsWith("minute") || unit.startsWith("hour")) {
    return 0;
  }
  if (unit.startsWith("day")) {
    return n;
  }
  if (unit.startsWith("week")) {
    return n * 7;
  }
  if (unit.startsWith("month")) {
    return n * 30;
  }
  if (unit.startsWith("year")) {
    return n * 365;
  }
  return null;
}

function jobKey(job) {
  return extractLinkedInJobId(job.link) || String(job.link || "").trim();
}

function toReportsPosixPath(relativePathFromReportsDir) {
  return String(relativePathFromReportsDir || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/u, "");
}

/** Все *-raw.md под reports/, включая подкаталоги. */
async function listAllRawReportFiles(rootDir) {
  const collected = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile() && ent.name.endsWith("-raw.md")) {
        collected.push(path.relative(rootDir, full));
      }
    }
  }
  await walk(rootDir);
  return collected
    .map((p) => p.split(path.sep).join("/"))
    .sort();
}

/** LinkedIn postings in this project are English or French — pick output language for summaries. */
function inferPostingLanguage(job) {
  const text = `${job.title || ""}\n${job.description_preview || ""}`.slice(0, 8000);
  let frScore = 0;
  if (/[àâçéèêëîïôùûüÿœæ]/i.test(text)) {
    frScore += 3;
  }
  const frRe =
    /\b(le|la|les|des|du|une|pour|avec|être|vous|nous|dans|sur|sont|poste|expérience|maîtrise|développeur|développeuse|candidat|candidature|salaire|bilingue|français|québec|montréal|télétravail|logiciel)\b/gi;
  const frM = text.match(frRe);
  if (frM) {
    frScore += frM.length;
  }
  let enScore = 0;
  const enRe =
    /\b(the|and|with|for|you|we|are|will|this|that|from|role|experience|developer|senior|remote|hybrid|team|work|software|years)\b/gi;
  const enM = text.match(enRe);
  if (enM) {
    enScore += enM.length;
  }
  if (frScore >= 4 && frScore + 1 >= enScore) {
    return "fr";
  }
  if (frScore > enScore * 1.15) {
    return "fr";
  }
  return "en";
}

function detectWorkType(text) {
  const lower = text.toLowerCase();
  if (lower.includes("remote")) {
    return "Remote";
  }
  if (lower.includes("hybrid")) {
    return "Hybrid";
  }
  if (lower.includes("on-site") || lower.includes("onsite") || lower.includes("in office") || lower.includes("in-office")) {
    return "On-site";
  }
  return "Unknown";
}

function summarizeWithOllama(job) {
  const model = process.env.OLLAMA_MODEL || "llama3.2:3b";
  const lang = inferPostingLanguage(job);
  const langLabel = lang === "fr" ? "French" : "English";
  const prompt = [
    `Summarize this job in 1-2 short sentences in ${langLabel} only.`,
    "Match the language of the vacancy (English or French). Do not use Russian or other languages.",
    "Focus on responsibilities and requirements.",
    "Use Latin script only for words (French accents ok); no Cyrillic, Devanagari, Chinese, etc.",
    "Do not start with labels like Summary:, Résumé:, Overview: — write the summary body directly.",
    "No bullet points, no markdown, max 220 characters.",
    "",
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Work type: ${job.work_type}`,
    "",
    "Description snippet:",
    job.description_preview,
  ].join("\n");

  return runOllama(model, prompt)
    .then((text) => finalizeOllamaSummaryText(text))
    .catch(() => {
      return "Summary unavailable (Ollama did not respond). Check that Ollama is running and OLLAMA_MODEL is set.";
    });
}

/** Drop stray script runs from small multilingual models; summaries should stay EN/FR. */
function finalizeOllamaSummaryText(text) {
  let s = String(text || "")
    .normalize("NFC")
    .replace(/^(?:итог|резюме|роспись|кратко|summary|résumé|resume|overview)\s*:\s*/i, "")
    .trim();

  s = s
    .replace(/\p{Script=Devanagari}/gu, "")
    .replace(/\p{Script=Han}/gu, "")
    .replace(/\p{Script=Hiragana}/gu, "")
    .replace(/\p{Script=Katakana}/gu, "")
    .replace(/\p{Script=Hangul}/gu, "")
    .replace(/\p{Script=Arabic}/gu, "")
    .replace(/\p{Script=Hebrew}/gu, "")
    .replace(/\p{Script=Thai}/gu, "")
    .replace(/\p{Script=Cyrillic}/gu, "");

  s = s.replace(/\s+/g, " ").trim();
  if (s.length > 240) {
    s = `${s.slice(0, 237)}…`;
  }
  return s || String(text || "").trim();
}

function classifyAiRoleWithOllama(job) {
  const model = process.env.OLLAMA_MODEL || "llama3.2:3b";
  const lang = inferPostingLanguage(job);
  const langLabel = lang === "fr" ? "French" : "English";
  const quote = String(job.ai_report_quote || "").trim();
  const descriptionBody =
    quote && !String(job.description_preview || "").includes(quote.slice(0, Math.min(quote.length, 80)))
      ? `${job.description_preview}\n\n---\nListing excerpt flagged for AI/IA wording:\n${quote}`
      : job.description_preview;
  const prompt = [
    'Reply with ONLY one JSON object (no markdown), keys: "verdict","keywords","reason".',
    'verdict: "yes" if this role substantially involves AI/ML engineering, LLM/RAG/agents, MLOps, or daily use of AI dev tools (Copilot, Cursor, ChatGPT API) as core work.',
    'verdict: "no" for ordinary mobile/web/backend roles with no meaningful AI/ML in responsibilities.',
    'verdict: "maybe" if AI is only buzzword, vague "AI-powered product", or unclear.',
    'verdict: "maybe" (not "no") if the JD explicitly asks to integrate AI workflows/tools or expects an AI/IA-minded engineer, even when the primary title is mobile/platform/general software.',
    'keywords: array of short English tokens seen or implied (e.g. "LLM","copilot","pytorch","rag") max 8 items.',
    `reason: one short sentence (max 140 chars) in ${langLabel} only, explaining the verdict. Do not use Russian.`,
    "",
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    "",
    "Description:",
    descriptionBody,
  ].join("\n");

  return runOllama(model, prompt, { temperature: 0.15, num_predict: 400 })
    .then((text) => normalizeAiClassification(parseJsonObjectFromOllama(text)))
    .catch(() => ({
      ai_verdict: "maybe",
      ai_keywords: [],
      ai_reason: "AI classification unavailable (Ollama did not respond).",
    }));
}

function parseJsonObjectFromOllama(text) {
  const raw = String(text || "").trim();
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let o = tryParse(raw);
  if (o && typeof o === "object" && !Array.isArray(o)) {
    return o;
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    o = tryParse(fence[1].trim());
    if (o && typeof o === "object" && !Array.isArray(o)) {
      return o;
    }
  }
  const brace = raw.match(/\{[\s\S]*\}/);
  if (brace) {
    o = tryParse(brace[0]);
    if (o && typeof o === "object" && !Array.isArray(o)) {
      return o;
    }
  }
  return {};
}

function normalizeAiClassification(obj) {
  const verdictRaw = String(obj.verdict ?? obj.verdict_ai ?? "").toLowerCase();
  let ai_verdict = "maybe";
  if (verdictRaw === "yes" || verdictRaw === "true") {
    ai_verdict = "yes";
  } else if (verdictRaw === "no" || verdictRaw === "false") {
    ai_verdict = "no";
  } else if (verdictRaw === "maybe" || verdictRaw === "unclear" || verdictRaw === "unknown") {
    ai_verdict = "maybe";
  }

  let keywords = [];
  if (Array.isArray(obj.keywords)) {
    keywords = obj.keywords.map((k) => String(k).trim()).filter(Boolean);
  } else if (typeof obj.keywords === "string") {
    keywords = obj.keywords
      .split(/[,;]+/)
      .map((k) => k.trim())
      .filter(Boolean);
  }
  keywords = [...new Set(keywords)].slice(0, 12);

  let ai_reason = String(obj.reason ?? obj.reason_ru ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  return {
    ai_verdict,
    ai_keywords: keywords,
    ai_reason: ai_reason || "—",
  };
}

async function runOllama(model, prompt, generateOptions = null) {
  const base = normalizeOllamaHost(process.env.OLLAMA_HOST || "http://127.0.0.1:11434");
  const url = `${base}/api/generate`;
  const bodyPayload = {
    model,
    prompt,
    stream: false,
  };
  if (generateOptions && typeof generateOptions === "object") {
    bodyPayload.options = generateOptions;
  }
  const verboseOllama = isTruthyEnv(process.env.PREPROCESS_VERBOSE_OLLAMA);
  const reqStarted = Date.now();
  if (verboseOllama) {
    preprocessLog(
      `Ollama POST /api/generate model=${model} prompt≈${prompt.length} chars`,
    );
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyPayload),
  });

  const result = await response.json().catch(() => ({}));
  if (verboseOllama) {
    const msg = typeof result.error === "string" ? result.error : "";
    preprocessLog(
      `Ollama HTTP ${response.status} in ${((Date.now() - reqStarted) / 1000).toFixed(2)}s${msg ? ` (${msg})` : ""}`,
    );
  }
  const message = typeof result.error === "string" ? result.error : "";
  const text = typeof result.response === "string" ? result.response.trim() : "";

  if (!response.ok || message) {
    throw new Error(message || `Ollama HTTP ${response.status}`);
  }

  if (!text) {
    throw new Error("Empty Ollama response");
  }

  await logOllamaComputePlacementOnce(base);
  return text;
}

function normalizeOllamaHost(value) {
  const trimmed = String(value || "").trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed.replace(/^\/\//, "")}`;
}

function extractLinkedInJobId(link) {
  const value = String(link || "");
  const match = value.match(/\/jobs\/view\/(\d+)/i);
  return match ? match[1] : "";
}

function extractAiMentionQuote(fullDescription) {
  const text = String(fullDescription || "");
  if (!text.trim()) {
    return "";
  }

  const aiRe =
    /\b(ai|a\.i\.|ia|intelligence artificielle|artificial intelligence|machine learning|deep learning|neural|genai|llm|rag|copilot|cursor|chatgpt|openai|claude|codex|mlops|agentic|agents?)\b/i;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (aiRe.test(line)) {
      return line.slice(0, 380);
    }
  }

  const sentenceParts = text.split(/(?<=[.!?;])\s+/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentenceParts) {
    if (aiRe.test(s)) {
      return s.slice(0, 380);
    }
  }

  return "";
}

async function preprocessOllamaForOneJob(job, index, total, recentTotals, tag = "") {
  const label = String(job.title || "Untitled").replace(/\s+/g, " ").slice(0, 72);
  const t0 = Date.now();
  job.short_summary = await summarizeWithOllama(job);
  const t1 = Date.now();
  Object.assign(job, await classifyAiRoleWithOllama(job));
  job.ai_classified_at = new Date().toISOString();
  const t2 = Date.now();

  const summarySec = ((t1 - t0) / 1000).toFixed(1);
  const classifySec = ((t2 - t1) / 1000).toFixed(1);
  const totalMs = t2 - t0;
  recentTotals.push(totalMs);
  if (recentTotals.length > 8) recentTotals.shift();

  const eta = formatEtaLine(total - index, recentTotals);
  const tagPart = tag && tag !== "rebuild" ? `[${tag}] ` : "";
  preprocessLog(
    `${tagPart}job ${index}/${total} "${label}" | summary ${summarySec}s | classify ${classifySec}s${eta}`,
  );
}

function isTruthyEnv(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function needsOllamaPreprocess(job) {
  const summary = String(job?.short_summary || "").trim();
  const verdict = String(job?.ai_verdict || "").toLowerCase();
  if (!summary || summary.includes("Summary unavailable")) {
    return true;
  }
  return !["yes", "no", "maybe"].includes(verdict);
}

/** Файлы ещё не в reports_processed, либо созданные в текущей сессии (run-today-live). */
async function resolveRawFilesToProcess(rawFiles, processedSet, dir, sessionStartMs) {
  const out = [];
  for (const name of rawFiles) {
    if (!processedSet.has(name)) {
      out.push(name);
      continue;
    }
    if (sessionStartMs > 0) {
      try {
        const info = await stat(path.join(dir, name));
        if (info.mtimeMs >= sessionStartMs) {
          out.push(name);
        }
      } catch {
        /* file removed between list and stat */
      }
    }
  }
  return out;
}
