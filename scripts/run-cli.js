import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureWinConsoleUtf8 } from "./win-console-utf8.js";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

export function getProjectRoot() {
  return path.resolve(scriptsDir, "..");
}

export function initCli() {
  ensureWinConsoleUtf8();
  process.chdir(getProjectRoot());
}

export function runNodeScript(relativePath, env = {}, nodeArgs = []) {
  const projectRoot = getProjectRoot();
  const scriptPath = path.join(projectRoot, relativePath);
  const result = spawnSync(process.execPath, [scriptPath, ...nodeArgs], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`node ${relativePath} failed: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

export function sessionStartMs() {
  return String(Date.now());
}

export function normalizeOllamaHost(host) {
  return String(host || "http://127.0.0.1:11434").replace(/\/$/, "");
}

export async function isOllamaReady(host = process.env.OLLAMA_HOST) {
  const base = normalizeOllamaHost(host);
  try {
    const res = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ensureOllamaRunning(host = process.env.OLLAMA_HOST) {
  if (await isOllamaReady(host)) {
    console.log("Ollama already running.");
    return;
  }

  const ollamaCmd = "ollama";
  const check = spawnSync(ollamaCmd, ["--version"], { stdio: "ignore" });
  if (check.error || check.status !== 0) {
    throw new Error("Command 'ollama' not found. Install Ollama and run again.");
  }

  console.log("Starting Ollama...");
  const child = spawn(ollamaCmd, ["serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  const base = normalizeOllamaHost(host);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isOllamaReady(host)) {
      console.log("Ollama is up.");
      return;
    }
  }

  throw new Error(`Ollama did not become ready on ${base}.`);
}

/** @param {string[]} argv */
export function parseCliFlags(argv) {
  const opts = {
    searchId: null,
    url: null,
    live: false,
    preprocessOnly: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--live") {
      opts.live = true;
    } else if (arg === "--preprocess-only") {
      opts.preprocessOnly = true;
    } else if (arg.startsWith("--search-id=")) {
      opts.searchId = arg.slice("--search-id=".length);
    } else if (arg === "--search-id" && argv[i + 1]) {
      opts.searchId = argv[++i];
    } else if (arg.startsWith("--url=")) {
      opts.url = arg.slice("--url=".length);
    } else if (arg === "--url" && argv[i + 1]) {
      opts.url = argv[++i];
    }
  }

  return opts;
}

export function loadCustomSearch(searchId) {
  const projectRoot = getProjectRoot();
  const configPath = path.join(projectRoot, "custom-searches", `${searchId}.json`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Custom search not found: custom-searches/${searchId}.json`);
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const url = String(config.url || "").trim();
  const name = String(config.title || config.name || config.id || searchId).trim();
  if (!url) {
    throw new Error("Search URL is empty.");
  }
  return { url, name, config };
}
