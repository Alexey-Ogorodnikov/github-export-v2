/**
 * dashboard-pipelines.js — дескрипторы пайплайнов запуска.
 */
import assert from "node:assert/strict";
import { describe } from "node:test";

import { buildExecutePipelineFromUrl } from "../scripts/dashboard-pipelines.js";
import { scenario } from "./helpers/scenario.js";

describe("buildExecutePipelineFromUrl", () => {
  scenario("валидный URL → pipeline с run-custom-search.js", () => {
    const url = "https://www.linkedin.com/jobs/search/?keywords=test";
    const pipeline = buildExecutePipelineFromUrl(url, "custom-test", "Test search");
    assert.ok(pipeline);
    assert.equal(pipeline.id, "custom-test");
    assert.equal(pipeline.label, "Test search");
    assert.equal(pipeline.script, "run-custom-search.js");
    assert.deepEqual(pipeline.nodeArgs, ["--url", url, "--live", "--preprocess-only"]);
  });

  scenario("пустой URL → null", () => {
    assert.equal(buildExecutePipelineFromUrl("", "id", "label"), null);
    assert.equal(buildExecutePipelineFromUrl(null, "id", "label"), null);
  });
});
