import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractJobKey } from "./dashboard-db.js";

export function getAppliedJobsPath(projectRoot = process.cwd()) {
  return path.join(projectRoot, "data", "applied-jobs.json");
}

export async function readAppliedJobsMap(projectRoot = process.cwd()) {
  const filePath = getAppliedJobsPath(projectRoot);
  try {
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeAppliedJobsMap(map, projectRoot = process.cwd()) {
  const filePath = getAppliedJobsPath(projectRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(map, null, 2), "utf8");
}

export function mergeAppliedIntoJobs(jobs, appliedMap) {
  if (!Array.isArray(jobs)) {
    return [];
  }
  const map = appliedMap && typeof appliedMap === "object" ? appliedMap : {};
  return jobs.map((job) => {
    const key = extractJobKey(job);
    const entry = key ? map[key] : null;
    if (!entry) {
      return { ...job, applied: false };
    }
    return {
      ...job,
      applied: true,
      applied_at: entry.applied_at || "",
    };
  });
}
