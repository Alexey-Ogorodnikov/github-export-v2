import { execSync } from "node:child_process";

export function ensureWinConsoleUtf8() {
  if (process.platform !== "win32") {
    return;
  }
  try {
    execSync("chcp 65001", { stdio: "ignore", windowsHide: true });
  } catch {
    // ignore
  }
}
