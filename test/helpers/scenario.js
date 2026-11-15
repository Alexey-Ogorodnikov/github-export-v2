import { it } from "node:test";

/**
 * Registers one documented unit-test scenario.
 * The `doc` string is the scenario name in test output and in doc/testing.md.
 *
 * @param {string} doc — краткое описание сценария
 * @param {() => void | Promise<void>} fn
 */
export function scenario(doc, fn) {
  it(doc, fn);
}
