/**
 * run-cli.js — parseCliFlags, normalizeOllamaHost.
 */
import assert from "node:assert/strict";
import { describe } from "node:test";

import { normalizeOllamaHost, parseCliFlags } from "../scripts/run-cli.js";
import { scenario } from "./helpers/scenario.js";

describe("normalizeOllamaHost", () => {
  scenario("пустое значение → default localhost:11434", () => {
    assert.equal(normalizeOllamaHost(""), "http://127.0.0.1:11434");
    assert.equal(normalizeOllamaHost(null), "http://127.0.0.1:11434");
  });

  scenario("убирает trailing slash", () => {
    assert.equal(normalizeOllamaHost("http://127.0.0.1:11434/"), "http://127.0.0.1:11434");
  });

  scenario("кастомный host сохраняется", () => {
    assert.equal(normalizeOllamaHost("http://192.168.1.5:11434"), "http://192.168.1.5:11434");
  });
});

describe("parseCliFlags", () => {
  scenario("пустой argv → все флаги false/null", () => {
    assert.deepEqual(parseCliFlags(["node", "script.js"]), {
      searchId: null,
      url: null,
      live: false,
      preprocessOnly: false,
    });
  });

  scenario("--live → live=true", () => {
    assert.equal(parseCliFlags(["node", "s", "--live"]).live, true);
  });

  scenario("--preprocess-only → preprocessOnly=true", () => {
    assert.equal(parseCliFlags(["node", "s", "--preprocess-only"]).preprocessOnly, true);
  });

  scenario("--search-id=foo → searchId", () => {
    assert.equal(parseCliFlags(["node", "s", "--search-id=foo"]).searchId, "foo");
  });

  scenario("--search-id foo → searchId (отдельный аргумент)", () => {
    assert.equal(parseCliFlags(["node", "s", "--search-id", "bar"]).searchId, "bar");
  });

  scenario("--url=https://x → url", () => {
    assert.equal(parseCliFlags(["node", "s", "--url=https://x"]).url, "https://x");
  });

  scenario("--url https://y → url (отдельный аргумент)", () => {
    assert.equal(parseCliFlags(["node", "s", "--url", "https://y"]).url, "https://y");
  });

  scenario("несколько флагов одновременно", () => {
    const opts = parseCliFlags([
      "node",
      "s",
      "--live",
      "--preprocess-only",
      "--search-id=abc",
      "--url=https://linkedin.com/jobs/search/",
    ]);
    assert.equal(opts.live, true);
    assert.equal(opts.preprocessOnly, true);
    assert.equal(opts.searchId, "abc");
    assert.equal(opts.url, "https://linkedin.com/jobs/search/");
  });

  scenario("неизвестные аргументы игнорируются", () => {
    const opts = parseCliFlags(["node", "s", "--verbose", "--url=z"]);
    assert.equal(opts.url, "z");
    assert.equal(opts.live, false);
  });
});
