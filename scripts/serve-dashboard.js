import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  mergeAppliedIntoJobs,
  readAppliedJobsMap,
  writeAppliedJobsMap,
} from "./applied-jobs.js";
import {
  mergeNotInterestedIntoJobs,
  readNotInterestedJobsMap,
  writeNotInterestedJobsMap,
} from "./not-interested-jobs.js";
import { extractJobKey, readDashboardSnapshot, writeDashboardSnapshot } from "./dashboard-db.js";
import {
  deleteCustomScenario,
  listScenariosForApi,
  reloadCustomScenarios,
  renameCustomScenario,
  saveCustomScenario,
  updateCustomScenario,
} from "./dashboard-scenarios.js";
import {
  getDashboardSettingsForApi,
  writeDashboardSettings,
} from "./dashboard-settings.js";
import {
  getRunStatus,
  clearRunLog,
  readRunLog,
  startCustomSearch,
  startRefreshJobs,
  startRunAll,
  startScenario,
  startUrlSearch,
} from "./dashboard-run-manager.js";
import { askOllamaAboutJob, mergeJobRecordsForOllama } from "./job-ollama-ask.js";
import { ensureWinConsoleUtf8 } from "./win-console-utf8.js";

ensureWinConsoleUtf8();

const projectRoot = process.cwd();
reloadCustomScenarios(projectRoot);
const dashboardJsonPath = path.join(projectRoot, "reports", "dashboard-jobs.json");
const requestedPort = Number.parseInt(process.env.PORT || "8080", 10);
const maxPortAttempts = 20;
let listeningPort = requestedPort;

function getApiBaseUrl() {
  return `http://127.0.0.1:${listeningPort}`;
}

function openDashboardInBrowser(url) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
}

function corsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = createServer(async (req, res) => {
  try {
    const requestPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (requestPath.startsWith("/api/") && req.method === "OPTIONS") {
      corsHeaders(res);
      res.writeHead(204).end();
      return;
    }
    if (requestPath === "/api/pipelines" || requestPath === "/api/scenarios") {
      reloadCustomScenarios(projectRoot);
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.writeHead(200).end(
        JSON.stringify({
          scenarios: listScenariosForApi(),
          settings: getDashboardSettingsForApi(projectRoot),
          apiBase: getApiBaseUrl(),
        }),
      );
      return;
    }
    if (requestPath === "/api/settings") {
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      if (req.method === "POST") {
        const body = await readRequestJson(req);
        if (body?.maxJobsPerSearch === undefined && body?.mandatoryTags === undefined) {
          res.writeHead(400).end(JSON.stringify({ ok: false, error: "missing_fields" }));
          return;
        }
        writeDashboardSettings(projectRoot, body || {});
        res.writeHead(200).end(JSON.stringify({ ok: true, settings: getDashboardSettingsForApi(projectRoot) }));
        return;
      }
      res.writeHead(200).end(JSON.stringify(getDashboardSettingsForApi(projectRoot)));
      return;
    }
    if (requestPath === "/api/scenarios/add" && req.method === "POST") {
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const body = await readRequestJson(req);
      try {
        const scenario = saveCustomScenario(projectRoot, body || {});
        res.writeHead(200).end(JSON.stringify({ ok: true, scenario }));
      } catch (e) {
        const message = String(e?.message || e);
        const error = message.includes("invalid")
          ? "invalid_url"
          : message.includes("keywords")
            ? "missing_keywords"
            : "invalid_search";
        res.writeHead(400).end(JSON.stringify({ ok: false, error, message }));
      }
      return;
    }
    if (requestPath === "/api/scenarios/update" && req.method === "POST") {
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const body = await readRequestJson(req);
      const id = typeof body?.id === "string" ? body.id.trim() : "";
      if (!id) {
        res.writeHead(400).end(JSON.stringify({ ok: false, error: "missing_id" }));
        return;
      }
      try {
        const scenario = updateCustomScenario(projectRoot, id, body || {});
        res.writeHead(200).end(JSON.stringify({ ok: true, scenario }));
      } catch (e) {
        const message = String(e?.message || e);
        const error =
          message === "builtin scenario"
            ? "builtin_scenario"
            : message === "not found"
              ? "not_found"
              : message.includes("invalid")
                ? "invalid_url"
                : message.includes("keywords")
                  ? "missing_keywords"
                  : "invalid_search";
        const status = error === "not_found" ? 404 : 400;
        res.writeHead(status).end(JSON.stringify({ ok: false, error, message }));
      }
      return;
    }
    if (requestPath === "/api/scenarios/rename" && req.method === "POST") {
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const body = await readRequestJson(req);
      const id = typeof body?.id === "string" ? body.id.trim() : "";
      const title = typeof body?.title === "string" ? body.title.trim() : "";
      if (!id) {
        res.writeHead(400).end(JSON.stringify({ ok: false, error: "missing_id" }));
        return;
      }
      if (!title) {
        res.writeHead(400).end(JSON.stringify({ ok: false, error: "missing_title" }));
        return;
      }
      try {
        const scenario = renameCustomScenario(projectRoot, id, title);
        res.writeHead(200).end(JSON.stringify({ ok: true, scenario }));
      } catch (e) {
        const message = String(e?.message || e);
        const error =
          message === "builtin scenario"
            ? "builtin_scenario"
            : message === "not found"
              ? "not_found"
              : message.includes("title")
                ? "missing_title"
                : "invalid";
        const status = error === "not_found" ? 404 : 400;
        res.writeHead(status).end(JSON.stringify({ ok: false, error, message }));
      }
      return;
    }
    if (requestPath === "/api/scenarios/delete" && req.method === "POST") {
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const body = await readRequestJson(req);
      const id = typeof body?.id === "string" ? body.id.trim() : "";
      if (!id) {
        res.writeHead(400).end(JSON.stringify({ ok: false, error: "missing_id" }));
        return;
      }
      try {
        deleteCustomScenario(projectRoot, id);
        res.writeHead(200).end(JSON.stringify({ ok: true, id }));
      } catch (e) {
        const message = String(e?.message || e);
        const error =
          message === "builtin scenario" ? "builtin_scenario" : message === "not found" ? "not_found" : "invalid";
        const status = error === "not_found" ? 404 : 400;
        res.writeHead(status).end(JSON.stringify({ ok: false, error, message }));
      }
      return;
    }
    if (requestPath === "/api/run-status") {
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.writeHead(200).end(JSON.stringify(getRunStatus()));
      return;
    }
    if (requestPath === "/api/run-log/clear" && req.method === "POST") {
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      try {
        clearRunLog(projectRoot);
        res.writeHead(200).end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500).end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
      return;
    }
    if (requestPath === "/api/run-log") {
      const log = await readRunLog(projectRoot);
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.writeHead(200).end(JSON.stringify({ ok: true, ...log }));
      return;
    }
    if (requestPath === "/api/run" && req.method === "POST") {
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const body = await readRequestJson(req);
      const mode = body?.mode === "test" ? "test" : "execute";
      let result;

      if (mode === "execute") {
        const action = typeof body?.action === "string" ? body.action.trim() : "";
        if (action === "run-all" || body?.runAll === true) {
          result = startRunAll(projectRoot);
          const status = result.ok ? 200 : result.error === "already_running" ? 409 : 400;
          res.writeHead(status).end(JSON.stringify(result));
          return;
        }
        if (action === "refresh" || body?.refresh === true) {
          result = startRefreshJobs(projectRoot);
          const status = result.ok ? 200 : result.error === "already_running" ? 409 : 400;
          res.writeHead(status).end(JSON.stringify(result));
          return;
        }
      }

      const directUrl = typeof body?.url === "string" ? body.url.trim() : "";
      const customPayload =
        body?.custom && typeof body.custom === "object" && !Array.isArray(body.custom)
          ? body.custom
          : typeof body?.keywords === "string" && body.keywords.trim()
            ? {
                keywords: body.keywords.trim(),
                days: body.days,
                workType: body.workType,
                country: body.country,
                city: body.city,
                region: body.region,
              }
            : null;

      if (directUrl) {
        const label =
          typeof body?.label === "string" && body.label.trim()
            ? body.label.trim()
            : "Custom search";
        result = await startUrlSearch(projectRoot, directUrl, label, mode);
      } else if (customPayload) {
        result = await startCustomSearch(projectRoot, customPayload, mode);
      } else {
        const scenarioId = (
          typeof body?.scenario === "string"
            ? body.scenario
            : typeof body?.pipeline === "string"
              ? body.pipeline
              : ""
        ).trim();
        if (!scenarioId) {
          res.writeHead(400).end(JSON.stringify({ error: "missing scenario" }));
          return;
        }
        result = await startScenario(projectRoot, scenarioId, mode);
      }
      const status = result.ok ? 200 : result.error === "already_running" ? 409 : 400;
      res.writeHead(status).end(JSON.stringify(result));
      return;
    }
    if (requestPath === "/api/dashboard-jobs") {
      const payload = await enrichDashboardPayload(await readDashboardPayload());
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.writeHead(200).end(JSON.stringify(payload));
      return;
    }
    if (requestPath === "/api/applied-jobs") {
      const appliedMap = await readAppliedJobsMap(projectRoot);
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.writeHead(200).end(JSON.stringify(appliedMap));
      return;
    }
    if (requestPath === "/api/not-interested-jobs") {
      const notInterestedMap = await readNotInterestedJobsMap(projectRoot);
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.writeHead(200).end(JSON.stringify(notInterestedMap));
      return;
    }
    if (requestPath === "/api/set-not-interested" && req.method === "POST") {
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const body = await readRequestJson(req);
      const jobKey = resolveJobKeyFromBody(body);
      if (!jobKey) {
        res.writeHead(400).end(JSON.stringify({ error: "missing job_key" }));
        return;
      }
      const notInterested = body?.not_interested === true;
      const notInterestedMap = await readNotInterestedJobsMap(projectRoot);
      if (notInterested) {
        notInterestedMap[jobKey] = { not_interested_at: new Date().toISOString() };
      } else {
        delete notInterestedMap[jobKey];
      }
      try {
        await writeNotInterestedJobsMap(notInterestedMap, projectRoot);
      } catch (e) {
        res
          .writeHead(500)
          .end(JSON.stringify({ error: String(e?.message || e || "write_failed") }));
        return;
      }
      res.writeHead(200).end(JSON.stringify({ ok: true, job_key: jobKey, not_interested: notInterested }));
      return;
    }
    if (requestPath === "/api/set-applied" && req.method === "POST") {
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const body = await readRequestJson(req);
      const jobKey = resolveJobKeyFromBody(body);
      if (!jobKey) {
        res.writeHead(400).end(JSON.stringify({ error: "missing job_key" }));
        return;
      }
      const applied = body?.applied === true;
      const appliedMap = await readAppliedJobsMap(projectRoot);
      if (applied) {
        appliedMap[jobKey] = { applied_at: new Date().toISOString() };
      } else {
        delete appliedMap[jobKey];
      }
      try {
        await writeAppliedJobsMap(appliedMap, projectRoot);
      } catch (e) {
        res
          .writeHead(500)
          .end(JSON.stringify({ error: String(e?.message || e || "write_failed") }));
        return;
      }
      res.writeHead(200).end(JSON.stringify({ ok: true, job_key: jobKey, applied }));
      return;
    }
    if (requestPath === "/api/job-ask" && req.method === "POST") {
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const body = (await readRequestJson(req)) || {};
      const question = String(body.question || body.job_question || "").trim();
      if (!question) {
        res.writeHead(400).end(JSON.stringify({ ok: false, error: "missing_question" }));
        return;
      }
      let payload;
      try {
        payload = await readDashboardJsonPayload();
      } catch {
        try {
          payload = await readDashboardSnapshot(projectRoot);
        } catch {
          res.writeHead(500).end(JSON.stringify({ ok: false, error: "read_failed" }));
          return;
        }
      }
      const job = resolveJobFromAskBody(body, payload);
      if (!job) {
        res.writeHead(404).end(JSON.stringify({ ok: false, error: "job_not_found" }));
        return;
      }
      try {
        const answer = await askOllamaAboutJob(job, question, { projectRoot });
        res.writeHead(200).end(JSON.stringify({ ok: true, answer }));
      } catch (e) {
        const message = String(e?.message || e);
        const status = /not running|question required/i.test(message) ? 400 : 503;
        res.writeHead(status).end(JSON.stringify({ ok: false, error: "ollama_error", message }));
      }
      return;
    }
    if (requestPath === "/api/remove-job" && req.method === "POST") {
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const body = await readRequestJson(req);
      const jobKey = typeof body?.job_key === "string" ? body.job_key.trim() : "";
      const link = typeof body?.link === "string" ? body.link.trim() : "";
      const title = typeof body?.title === "string" ? body.title.trim() : "";
      const company = typeof body?.company === "string" ? body.company.trim() : "";
      const candidateKeys = new Set([jobKey, extractJobKey({ link }), link].filter(Boolean));

      if (candidateKeys.size === 0 && (!title || !company)) {
        res.writeHead(400).end(JSON.stringify({ error: "missing job_key" }));
        return;
      }
      let payload;
      try {
        payload = await readDashboardJsonPayload();
      } catch {
        res.writeHead(500).end(JSON.stringify({ error: "read_failed" }));
        return;
      }
      const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      const filtered = jobs.filter((j) => {
        const k = extractJobKey(j);
        const l = String(j?.link || "").trim();
        if ((k && candidateKeys.has(k)) || (l && candidateKeys.has(l))) {
          return false;
        }
        if (
          title &&
          company &&
          String(j?.title || "").trim() === title &&
          String(j?.company || "").trim() === company
        ) {
          return false;
        }
        return true;
      });
      if (filtered.length === jobs.length) {
        res.writeHead(404).end(
          JSON.stringify({
            error: "job_not_found",
            job_key: jobKey,
            link,
            jobs_count: jobs.length,
          }),
        );
        return;
      }
      const next = {
        ...payload,
        jobs: filtered,
        jobs_count: filtered.length,
        generated_at: new Date().toISOString(),
      };
      try {
        await writeFile(dashboardJsonPath, JSON.stringify(next, null, 2), "utf8");
        writeDashboardSnapshot(next, projectRoot);
      } catch (e) {
        res
          .writeHead(500)
          .end(JSON.stringify({ error: String(e?.message || e || "write_failed") }));
        return;
      }
      res.writeHead(200).end(JSON.stringify({ ok: true, jobs_count: filtered.length }));
      return;
    }
    if (requestPath === "/api/remove-all-jobs" && req.method === "POST") {
      corsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      let payload;
      try {
        payload = await readDashboardJsonPayload();
      } catch {
        res.writeHead(500).end(JSON.stringify({ error: "read_failed" }));
        return;
      }
      const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      const removedCount = jobs.length;
      const next = {
        ...payload,
        jobs: [],
        jobs_count: 0,
        generated_at: new Date().toISOString(),
      };
      try {
        await writeFile(dashboardJsonPath, JSON.stringify(next, null, 2), "utf8");
        writeDashboardSnapshot(next, projectRoot);
        await writeAppliedJobsMap({}, projectRoot);
        await writeNotInterestedJobsMap({}, projectRoot);
      } catch (e) {
        res
          .writeHead(500)
          .end(JSON.stringify({ error: String(e?.message || e || "write_failed") }));
        return;
      }
      res.writeHead(200).end(JSON.stringify({ ok: true, removed_count: removedCount, jobs_count: 0 }));
      return;
    }
    const normalized = requestPath === "/" ? "/web/jobs-dashboard.html" : requestPath;
    const filePath = path.join(projectRoot, normalized);

    if (!filePath.startsWith(projectRoot)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    const info = await stat(filePath);
    if (!info.isFile()) {
      res.writeHead(404).end("Not Found");
      return;
    }

    const content = await readFile(filePath);
    res.setHeader("Content-Type", getContentType(filePath));
    if (/\.html?$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
    res.writeHead(200).end(content);
  } catch {
    res.writeHead(404).end("Not Found");
  }
});

const port = await findAvailablePort(requestedPort, maxPortAttempts);
listeningPort = port;
if (port !== requestedPort) {
  console.log(`Port ${requestedPort} busy, using ${port}.`);
  console.log(`Open this URL in the browser: ${getApiBaseUrl()}/`);
}
server.listen(port, "127.0.0.1", () => {
  const url = `${getApiBaseUrl()}/`;
  console.log(`Dashboard: ${url}`);
  console.log(
    `Remove jobs: POST /api/remove-job on this port. If the page is served elsewhere (e.g. :3000), add ?api=${getApiBaseUrl()}`,
  );
  if (process.env.DASHBOARD_OPEN_BROWSER === "1") {
    openDashboardInBrowser(url);
  }
});

function getContentType(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

async function findAvailablePort(startPort, attemptsLeft) {
  if (process.env.PORT) {
    return startPort;
  }

  for (let step = 0; step <= attemptsLeft; step += 1) {
    const candidate = startPort + step;
    // Probe port with a temporary server before running dashboard.
    const isFree = await canListen(candidate);
    if (isFree) {
      return candidate;
    }
  }

  throw new Error(`No free port found in range ${startPort}-${startPort + attemptsLeft}.`);
}

function canListen(port) {
  return new Promise((resolve) => {
    const probe = createNetServer();

    probe.once("error", () => {
      resolve(false);
    });

    probe.listen(port, () => {
      probe.close(() => resolve(true));
    });
  });
}

async function readDashboardPayload() {
  try {
    return await readDashboardJsonPayload();
  } catch {
    return readDashboardSnapshot(projectRoot);
  }
}

async function enrichDashboardPayload(payload) {
  const appliedMap = await readAppliedJobsMap(projectRoot);
  const notInterestedMap = await readNotInterestedJobsMap(projectRoot);
  const withApplied = mergeAppliedIntoJobs(Array.isArray(payload?.jobs) ? payload.jobs : [], appliedMap);
  const jobs = mergeNotInterestedIntoJobs(withApplied, notInterestedMap);
  return {
    ...payload,
    jobs,
    jobs_count: jobs.length,
  };
}

function resolveJobKeyFromBody(body) {
  const jobKey = typeof body?.job_key === "string" ? body.job_key.trim() : "";
  if (jobKey) {
    return jobKey;
  }
  const link = typeof body?.link === "string" ? body.link.trim() : "";
  return extractJobKey({ link }) || link;
}

async function readDashboardJsonPayload() {
  const dashboardText = await readFile(dashboardJsonPath, "utf8");
  return JSON.parse(dashboardText);
}

function resolveJobFromAskBody(body, payload) {
  const jobKey = typeof body?.job_key === "string" ? body.job_key.trim() : "";
  const link = typeof body?.link === "string" ? body.link.trim() : "";
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  let stored = null;
  for (const job of jobs) {
    const key = extractJobKey(job);
    if (jobKey && (key === jobKey || String(job.link || "").trim() === jobKey)) {
      stored = job;
      break;
    }
    if (link && String(job.link || "").trim() === link) {
      stored = job;
      break;
    }
  }
  const client =
    body?.job && typeof body.job === "object" && !Array.isArray(body.job) ? body.job : null;
  if (stored && client) {
    return mergeJobRecordsForOllama(stored, client);
  }
  if (stored) {
    return stored;
  }
  if (
    client &&
    String(
      client.title || client.description_preview || client.short_summary || client.link || "",
    ).trim()
  ) {
    return client;
  }
  return null;
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
}
