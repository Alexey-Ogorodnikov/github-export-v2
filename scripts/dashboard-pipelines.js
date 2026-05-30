import path from "node:path";
import { getMaxJobsPerSearch } from "./dashboard-settings.js";

/** @typedef {{ id: string, label: string, script: string, nodeArgs: string[], env?: Record<string, string> }} Pipeline */

/** @param {string} url @param {string} id @param {string} label */
export function buildExecutePipelineFromUrl(url, id, label) {
  if (!url) {
    return null;
  }
  return {
    id,
    label,
    script: "run-custom-search.js",
    nodeArgs: ["--url", url, "--live", "--preprocess-only"],
  };
}

/** @param {string} url @param {string} id @param {string} label */
export function buildTestPreviewSpawnFromUrl(projectRoot, url, id, label) {
  if (!url) {
    return null;
  }
  const scriptPath = path.join(projectRoot, "scripts", "run-linkedin-test.js");
  return {
    id: `${id}-test`,
    label: `${label} (тест)`,
    command: process.execPath,
    args: [scriptPath, "--url", url],
    cwd: projectRoot,
  };
}

export function buildExecuteSpawn(projectRoot, pipeline) {
  const scriptPath = path.join(projectRoot, "scripts", pipeline.script);
  const args = [scriptPath, ...pipeline.nodeArgs];
  const env = {
    ...process.env,
    DASHBOARD_SKIP_SERVE: "1",
    LINKEDIN_MAX_JOBS: String(getMaxJobsPerSearch(projectRoot)),
    ...pipeline.env,
  };
  return {
    command: process.execPath,
    args,
    env,
    cwd: projectRoot,
    detached: false,
  };
}
