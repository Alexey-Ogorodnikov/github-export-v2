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

const filterRaw = String(process.env.RUN_TODAY_SEARCH_IDS || "").trim();
const filterIds = filterRaw
  ? new Set(
      filterRaw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    )
  : null;

const selectedFiles =
  filterIds && filterIds.size > 0
    ? files.filter((name) => {
        const configPath = path.join(configDir, name);
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        const searchId = String(config.id || "").trim() || path.basename(name, ".json");
        return filterIds.has(searchId);
      })
    : files;

if (selectedFiles.length === 0) {
  console.error(
    filterIds && filterIds.size > 0
      ? "No matching custom search configs for the selected IDs."
      : "No custom search configs in custom-searches/",
  );
  process.exit(1);
}

console.log(`Running ${selectedFiles.length} custom search(es)...`);

for (const file of selectedFiles) {
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
