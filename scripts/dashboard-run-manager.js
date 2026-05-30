import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  buildExecutePipelineFromUrl,
  buildExecuteSpawn,
  buildTestPreviewSpawnFromUrl,
} from "./dashboard-pipelines.js";
import { buildScenarioFromParams, getScenario } from "./dashboard-scenarios.js";

/** @type {{ status: string, scenarioId: string|null, mode: string|null, label: string|null, startedAt: string|null, finishedAt: string|null, exitCode: number|null, message: string }} */
let runState = {
  status: "idle",
  scenarioId: null,
  mode: null,
  label: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  message: "",
};

let activeChild = null;
let testPreviewChild = null;

const TEST_START_TIMEOUT_MS = 12000;
const TEST_PROFILE_UNLOCK_MS = 2000;

function stripAnsi(text) {
  return String(text || "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function killProcessTree(child) {
  if (!child || child.killed) {
    return;
  }
  const pid = child.pid;
  if (!pid) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function stopTestPreviewChild() {
  if (!testPreviewChild) {
    return;
  }
  killProcessTree(testPreviewChild);
  testPreviewChild = null;
  await delay(TEST_PROFILE_UNLOCK_MS);
}

function isBrowserProfileBusyLog(text) {
  return /existing browser session|user data dir.*in use|profile.*in use|ProcessSingleton|Target page, context or browser has been closed/i.test(
    text,
  );
}

function formatTestFailureMessage(projectRoot, code) {
  const tail = stripAnsi(tailLogLines(projectRoot));
  if (isBrowserProfileBusyLog(tail)) {
    return "Тест не запустился: профиль браузера занят. Закройте предыдущее окно Test или Chrome с LinkedIn и повторите.";
  }
  if (tail) {
    return `Тест завершился с ошибкой (код ${code}).\n${tail}`;
  }
  return `Тест завершился с ошибкой (код ${code}). См. reports/run.log`;
}

export function getRunStatus() {
  return { ...runState };
}

function appendRunLog(projectRoot, line) {
  const logPath = path.join(projectRoot, "reports", "run.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, line);
}

function tailLogLines(projectRoot, maxLines = 8) {
  const logPath = path.join(projectRoot, "reports", "run.log");
  if (!fs.existsSync(logPath)) {
    return "";
  }
  try {
    const text = fs.readFileSync(logPath, "utf8");
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

const RUN_LOG_MAX_BYTES = 1024 * 1024;

/** Full reports/run.log for dashboard console history (truncates very large files). */
export function clearRunLog(projectRoot) {
  const logPath = path.join(projectRoot, "reports", "run.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, "", "utf8");
}

export async function readRunLog(projectRoot) {
  const logPath = path.join(projectRoot, "reports", "run.log");
  if (!fs.existsSync(logPath)) {
    return { content: "", truncated: false, size: 0 };
  }
  try {
    const stat = fs.statSync(logPath);
    const size = stat.size;
    if (size <= RUN_LOG_MAX_BYTES) {
      const content = fs.readFileSync(logPath, "utf8");
      return { content, truncated: false, size };
    }
    const fd = fs.openSync(logPath, "r");
    try {
      const buffer = Buffer.alloc(RUN_LOG_MAX_BYTES);
      const start = Math.max(0, size - RUN_LOG_MAX_BYTES);
      fs.readSync(fd, buffer, 0, RUN_LOG_MAX_BYTES, start);
      let content = buffer.toString("utf8");
      const nl = content.indexOf("\n");
      if (nl >= 0 && start > 0) {
        content = content.slice(nl + 1);
      }
      return { content, truncated: true, size, bytesShown: RUN_LOG_MAX_BYTES };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { content: "", truncated: false, size: 0 };
  }
}

function attachChildLogging(projectRoot, child, label) {
  const logPath = path.join(projectRoot, "reports", "run.log");

  const appendLog = (chunk) => {
    const text = chunk.toString("utf8");
    fs.appendFile(logPath, text, () => {});
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length) {
      runState.message = lines[lines.length - 1];
    }
  };

  child.stdout?.on("data", appendLog);
  child.stderr?.on("data", appendLog);

  child.on("error", (err) => {
    runState.status = "error";
    runState.finishedAt = new Date().toISOString();
    runState.message = String(err?.message || err);
    activeChild = null;
  });

  child.on("exit", (code) => {
    runState.exitCode = code ?? 1;
    runState.finishedAt = new Date().toISOString();
    runState.status = code === 0 ? "done" : "error";
    runState.message =
      code === 0
        ? "Готово."
        : `Завершено с ошибкой (код ${code}). Подробности: reports/run.log`;
    activeChild = null;
  });

  appendRunLog(projectRoot, `\n--- ${new Date().toISOString()} ${label} ---\n`);
}

function waitForTestLaunch(projectRoot, child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const onEarlyExit = (code) => {
      finish({
        ok: false,
        error: "test_failed",
        run: {
          status: "error",
          label: runState.label,
          message: formatTestFailureMessage(projectRoot, code),
        },
      });
    };

    child.on("error", (err) => {
      finish({
        ok: false,
        error: "spawn_failed",
        run: {
          status: "error",
          message: String(err?.message || err),
        },
      });
    });

    child.on("exit", (code) => {
      if (!settled && code !== 0) {
        onEarlyExit(code ?? 1);
      }
    });

    setTimeout(() => {
      if (child.exitCode !== null) {
        return;
      }
      finish({
        ok: true,
        run: {
          status: "preview",
          scenarioId: runState.scenarioId,
          mode: "test",
          label: runState.label,
          message:
            "LinkedIn открыт: 1 вакансия для просмотра. Окно не закроётся. Отчёты не создаются.",
        },
      });
    }, TEST_START_TIMEOUT_MS);
  });
}

export async function startUrlSearch(projectRoot, url, label, mode) {
  const trimmedUrl = String(url || "").trim();
  if (!trimmedUrl) {
    return { ok: false, error: "invalid_url" };
  }
  const runId = `custom-${Date.now()}`;
  return startUrlRun(projectRoot, trimmedUrl, label || "Custom search", runId, mode);
}

async function startUrlRun(projectRoot, url, label, runId, mode) {
  const normalizedMode = mode === "test" ? "test" : "execute";

  if (normalizedMode === "execute" && runState.status === "running" && activeChild) {
    return { ok: false, error: "already_running", run: getRunStatus() };
  }

  if (normalizedMode === "test") {
    if (runState.status === "running" && activeChild) {
      return { ok: false, error: "already_running", run: getRunStatus() };
    }

    await stopTestPreviewChild();

    const spawnSpec = buildTestPreviewSpawnFromUrl(projectRoot, url, runId, label);
    if (!spawnSpec) {
      return { ok: false, error: "invalid_url" };
    }

    runState = {
      status: "running",
      scenarioId: runId,
      mode: "test",
      label,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      message: "Запуск теста…",
    };

    appendRunLog(
      projectRoot,
      `\n--- ${new Date().toISOString()} test ${runId} — ${label} ---\n`,
    );

    const logPath = path.join(projectRoot, "reports", "run.log");
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: spawnSpec.cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    });

    const appendTestLog = (chunk) => {
      fs.appendFile(logPath, chunk.toString("utf8"), () => {});
    };
    child.stdout?.on("data", appendTestLog);
    child.stderr?.on("data", appendTestLog);

    const result = await waitForTestLaunch(projectRoot, child);
    if (!result.ok) {
      runState = {
        status: "error",
        scenarioId: runId,
        mode: "test",
        label,
        startedAt: runState.startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: 1,
        message: result.run?.message || "Ошибка теста",
      };
      try {
        killProcessTree(child);
      } catch {
        /* ignore */
      }
      testPreviewChild = null;
      return result;
    }

    runState = {
      status: "preview",
      scenarioId: runId,
      mode: "test",
      label,
      startedAt: runState.startedAt,
      finishedAt: null,
      exitCode: null,
      message: result.run.message,
    };

    testPreviewChild = child;
    child.on("exit", () => {
      if (testPreviewChild === child) {
        testPreviewChild = null;
      }
    });

    return result;
  }

  await stopTestPreviewChild();

  const pipeline = buildExecutePipelineFromUrl(url, runId, label);
  if (!pipeline) {
    return { ok: false, error: "invalid_url" };
  }

  const { command, args, env, cwd } = buildExecuteSpawn(projectRoot, pipeline);
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });
  activeChild = child;

  runState = {
    status: "running",
    scenarioId: runId,
    mode: "execute",
    label,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    message: "Запущено…",
  };

  attachChildLogging(projectRoot, child, `execute ${runId} — ${label}`);

  return { ok: true, run: getRunStatus() };
}

/**
 * @param {string} projectRoot
 * @param {{ keywords?: string, days?: number, workType?: string, region?: string }} custom
 * @param {"test"|"execute"} mode
 */
export async function startCustomSearch(projectRoot, custom, mode) {
  let built;
  try {
    const urlInput = typeof custom?.url === "string" ? custom.url.trim() : "";
    built = buildScenarioFromParams(urlInput ? { url: urlInput } : custom);
  } catch (e) {
    const message = String(e?.message || e);
    if (message.includes("invalid")) {
      return { ok: false, error: "invalid_url" };
    }
    return { ok: false, error: "missing_keywords" };
  }

  const runId = `custom-${Date.now()}`;
  return startUrlRun(projectRoot, built.url, built.title, runId, mode);
}

export async function startScenario(projectRoot, scenarioId, mode) {
  const scenario = getScenario(scenarioId);
  if (!scenario) {
    return { ok: false, error: "unknown_scenario" };
  }
  return startUrlRun(projectRoot, scenario.url, scenario.title, scenarioId, mode);
}

function startBackgroundScript(projectRoot, scriptRel, label, runId) {
  if (runState.status === "running" && activeChild) {
    return { ok: false, error: "already_running", run: getRunStatus() };
  }

  const scriptPath = path.join(projectRoot, scriptRel);
  const child = spawn(process.execPath, [scriptPath], {
    cwd: projectRoot,
    env: { ...process.env, DASHBOARD_SKIP_SERVE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });
  activeChild = child;

  runState = {
    status: "running",
    scenarioId: runId,
    mode: "execute",
    label,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    message: "Запущено…",
  };

  attachChildLogging(projectRoot, child, `execute ${runId} — ${label}`);
  return { ok: true, run: getRunStatus() };
}

/** All custom-searches: LinkedIn scrape + Ollama → dashboard-jobs.json */
export function startRunAll(projectRoot) {
  return startBackgroundScript(
    projectRoot,
    "scripts/run-today-live.js",
    "Все сохранённые поиски",
    "run-all",
  );
}

/** Rebuild dashboard-jobs.json from existing reports/ (no LinkedIn scrape). */
export function startRefreshJobs(projectRoot) {
  return startBackgroundScript(
    projectRoot,
    "scripts/refresh-dashboard-jobs.js",
    "Обновление списка вакансий",
    "refresh-jobs",
  );
}
