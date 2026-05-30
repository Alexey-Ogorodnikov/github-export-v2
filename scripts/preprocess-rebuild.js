import { initCli, runNodeScript } from "./run-cli.js";

initCli();
process.env.PREPROCESS_REBUILD = "1";
process.exit(runNodeScript("scripts/preprocess-reports-ollama.js"));
