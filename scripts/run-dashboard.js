import { initCli, runNodeScript } from "./run-cli.js";

initCli();
process.env.DASHBOARD_OPEN_BROWSER = "1";
process.exit(runNodeScript("scripts/serve-dashboard.js"));
