import { mkdir, readFile, writeFile } from "node:fs/promises";

import path from "node:path";

import { extractJobKey } from "./dashboard-db.js";



export function getNotInterestedJobsPath(projectRoot = process.cwd()) {

  return path.join(projectRoot, "data", "not-interested-jobs.json");

}



export async function readNotInterestedJobsMap(projectRoot = process.cwd()) {

  const filePath = getNotInterestedJobsPath(projectRoot);

  try {

    const text = await readFile(filePath, "utf8");

    const parsed = JSON.parse(text);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};

  } catch {

    return {};

  }

}



export async function writeNotInterestedJobsMap(map, projectRoot = process.cwd()) {

  const filePath = getNotInterestedJobsPath(projectRoot);

  await mkdir(path.dirname(filePath), { recursive: true });

  await writeFile(filePath, JSON.stringify(map, null, 2), "utf8");

}



export function mergeNotInterestedIntoJobs(jobs, notInterestedMap) {

  if (!Array.isArray(jobs)) {

    return [];

  }

  const map = notInterestedMap && typeof notInterestedMap === "object" ? notInterestedMap : {};

  return jobs.map((job) => {

    const key = extractJobKey(job);

    const entry = key ? map[key] : null;

    if (!entry) {

      return { ...job, not_interested: false };

    }

    return {

      ...job,

      not_interested: true,

      not_interested_at: entry.not_interested_at || "",

    };

  });

}


