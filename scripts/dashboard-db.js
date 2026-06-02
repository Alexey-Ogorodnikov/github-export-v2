import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export function getDashboardDbPath(projectRoot = process.cwd()) {
  return path.join(projectRoot, "data", "dashboard.db");
}

export function writeDashboardSnapshot(snapshot, projectRoot = process.cwd()) {
  const dbPath = getDashboardDbPath(projectRoot);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    initSchema(db);
    const jobs = Array.isArray(snapshot?.jobs) ? snapshot.jobs : [];
    const nowIso = new Date().toISOString();

    const tx = db.transaction(() => {
      db.prepare("DELETE FROM jobs").run();

      const insertJob = db.prepare(
        "INSERT INTO jobs (job_key, payload_json, updated_at) VALUES (?, ?, ?)",
      );
      for (const job of jobs) {
        const key = extractJobKey(job);
        if (!key) continue;
        insertJob.run(key, JSON.stringify(job), nowIso);
      }

      const upsertMeta = db.prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      );
      upsertMeta.run("generated_at", String(snapshot?.generated_at || ""));
      upsertMeta.run("aggregate", String(snapshot?.aggregate || ""));
      upsertMeta.run("generated_on_date", String(snapshot?.generated_on_date || ""));
      upsertMeta.run("jobs_count", String(snapshot?.jobs_count ?? jobs.length));
      upsertMeta.run("reports_processed_json", JSON.stringify(snapshot?.reports_processed || []));
      upsertMeta.run("updated_at", nowIso);
    });

    tx();
  } finally {
    db.close();
  }
}

export function readDashboardSnapshot(projectRoot = process.cwd()) {
  const dbPath = getDashboardDbPath(projectRoot);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    initSchema(db);
    const jobs = db
      .prepare("SELECT payload_json FROM jobs")
      .all()
      .map((row) => {
        try {
          return JSON.parse(row.payload_json);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const metaRows = db.prepare("SELECT key, value FROM meta").all();
    const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
    let reportsProcessed = [];
    try {
      reportsProcessed = JSON.parse(meta.reports_processed_json || "[]");
    } catch {
      reportsProcessed = [];
    }

    return {
      generated_at: meta.generated_at || "",
      aggregate: meta.aggregate || "all-raw-reports",
      generated_on_date: meta.generated_on_date || "",
      reports_processed: Array.isArray(reportsProcessed) ? reportsProcessed : [],
      jobs_count: Number.parseInt(meta.jobs_count || String(jobs.length), 10) || jobs.length,
      jobs,
    };
  } finally {
    db.close();
  }
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function extractJobKey(job) {
  const link = String(job?.link || "");
  const m = link.match(/\/jobs\/view\/(\d+)/i);
  if (m) return m[1];
  return link.trim();
}

/** LinkedIn numeric IDs (or URL fallback) already in dashboard-jobs.json / dashboard.db. */
export function loadExistingJobKeySet(projectRoot = process.cwd()) {
  const keys = new Set();
  const dbPath = getDashboardDbPath(projectRoot);

  if (existsSync(dbPath)) {
    try {
      const db = new Database(dbPath, { readonly: true });
      try {
        initSchema(db);
        for (const row of db.prepare("SELECT job_key FROM jobs").all()) {
          const key = String(row?.job_key || "").trim();
          if (key) keys.add(key);
        }
      } finally {
        db.close();
      }
      return keys;
    } catch {
      // fall through to JSON
    }
  }

  const jsonPath = path.join(projectRoot, "reports", "dashboard-jobs.json");
  if (existsSync(jsonPath)) {
    try {
      const snapshot = JSON.parse(readFileSync(jsonPath, "utf8"));
      for (const job of snapshot?.jobs || []) {
        const key = extractJobKey(job);
        if (key) keys.add(key);
      }
    } catch {
      // empty set
    }
  }

  return keys;
}
