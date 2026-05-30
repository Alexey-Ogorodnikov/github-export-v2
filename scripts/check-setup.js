import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

await mkdir("reports", { recursive: true });
await mkdir("browser-profile", { recursive: true });

console.log("Node.js OK");
console.log("Playwright OK");
console.log(`Chromium executable: ${chromium.executablePath()}`);
console.log("Folders OK: browser-profile, reports");

