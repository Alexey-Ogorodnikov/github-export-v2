import fs from "node:fs";
import path from "node:path";
import { getProjectRoot, initCli, runNodeScript } from "./run-cli.js";

initCli();

const configDir = path.join(getProjectRoot(), "custom-searches");
if (!fs.existsSync(configDir)) {
  console.error("No custom-searches folder found.");
  process.exit(1);
}

const files = fs
  .readdirSync(configDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.error("No custom search configs in custom-searches/");
  process.exit(1);
}

console.log(`Running ${files.length} custom LinkedIn search(es)...`);

for (const file of files) {
  const configPath = path.join(configDir, file);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const searchId = String(config.id || "").trim() || path.basename(file, ".json");

  console.log("");
  console.log(`Search: ${searchId}`);
  const code = runNodeScript("scripts/run-custom-search.js", {}, [
    "--search-id",
    searchId,
  ]);
  if (code !== 0) {
    process.exit(code);
  }
}
