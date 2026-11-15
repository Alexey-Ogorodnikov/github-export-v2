/**
 * applied-jobs.js / not-interested-jobs.js — слияние флагов с списком вакансий.
 */
import assert from "node:assert/strict";
import { describe } from "node:test";

import { mergeAppliedIntoJobs } from "../scripts/applied-jobs.js";
import { mergeNotInterestedIntoJobs } from "../scripts/not-interested-jobs.js";
import { scenario } from "./helpers/scenario.js";

const jobs = [
  { title: "Job A", link: "https://www.linkedin.com/jobs/view/111/", company: "Acme" },
  { title: "Job B", link: "https://www.linkedin.com/jobs/view/222/", company: "Beta" },
  { title: "Job C", link: "https://www.linkedin.com/jobs/view/333/", company: "Gamma" },
];

describe("mergeAppliedIntoJobs", () => {
  scenario("вакансия в map → applied=true + applied_at", () => {
    const merged = mergeAppliedIntoJobs(jobs, {
      111: { applied_at: "2026-06-01T12:00:00.000Z" },
    });
    assert.equal(merged[0].applied, true);
    assert.equal(merged[0].applied_at, "2026-06-01T12:00:00.000Z");
    assert.equal(merged[0].company, "Acme");
  });

  scenario("вакансия не в map → applied=false", () => {
    const merged = mergeAppliedIntoJobs(jobs, { 111: { applied_at: "x" } });
    assert.equal(merged[1].applied, false);
    assert.equal(merged[1].applied_at, undefined);
  });

  scenario("запись без applied_at → applied=true, applied_at=''", () => {
    const merged = mergeAppliedIntoJobs(jobs, { 222: {} });
    assert.equal(merged[1].applied, true);
    assert.equal(merged[1].applied_at, "");
  });

  scenario("null / не объект map → все applied=false", () => {
    const merged = mergeAppliedIntoJobs(jobs, null);
    assert.ok(merged.every((j) => j.applied === false));
  });

  scenario("jobs не массив → []", () => {
    assert.deepEqual(mergeAppliedIntoJobs(null, {}), []);
    assert.deepEqual(mergeAppliedIntoJobs(undefined, {}), []);
  });

  scenario("исходный массив не мутируется", () => {
    const copy = jobs.map((j) => ({ ...j }));
    mergeAppliedIntoJobs(copy, { 111: { applied_at: "x" } });
    assert.equal(copy[0].applied, undefined);
  });

  scenario("несколько applied одновременно", () => {
    const merged = mergeAppliedIntoJobs(jobs, {
      111: { applied_at: "a" },
      333: { applied_at: "b" },
    });
    assert.equal(merged[0].applied, true);
    assert.equal(merged[1].applied, false);
    assert.equal(merged[2].applied, true);
  });
});

describe("mergeNotInterestedIntoJobs", () => {
  scenario("вакансия в map → not_interested=true + timestamp", () => {
    const merged = mergeNotInterestedIntoJobs(jobs, {
      222: { not_interested_at: "2026-06-01T13:00:00.000Z" },
    });
    assert.equal(merged[1].not_interested, true);
    assert.equal(merged[1].not_interested_at, "2026-06-01T13:00:00.000Z");
  });

  scenario("вакансия не в map → not_interested=false", () => {
    const merged = mergeNotInterestedIntoJobs(jobs, { 222: { not_interested_at: "x" } });
    assert.equal(merged[0].not_interested, false);
  });

  scenario("запись без timestamp → not_interested=true, not_interested_at=''", () => {
    const merged = mergeNotInterestedIntoJobs(jobs, { 111: {} });
    assert.equal(merged[0].not_interested, true);
    assert.equal(merged[0].not_interested_at, "");
  });

  scenario("null map → все not_interested=false", () => {
    const merged = mergeNotInterestedIntoJobs(jobs, null);
    assert.ok(merged.every((j) => j.not_interested === false));
  });

  scenario("jobs не массив → []", () => {
    assert.deepEqual(mergeNotInterestedIntoJobs(undefined, {}), []);
  });

  scenario("исходный массив не мутируется", () => {
    const copy = jobs.map((j) => ({ ...j }));
    mergeNotInterestedIntoJobs(copy, { 111: { not_interested_at: "x" } });
    assert.equal(copy[0].not_interested, undefined);
  });
});
