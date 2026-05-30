import { launchLinkedInContext } from "./browser-launch.js";

const profileDir = "browser-profile";
const context = await launchLinkedInContext(profileDir);

const page = context.pages()[0] ?? await context.newPage();
await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });

console.log("Browser opened.");
console.log("Log in with email/password on LinkedIn (avoid “Continue with Google” if blocked).");
console.log("When finished, close the browser window.");

await page.waitForTimeout(24 * 60 * 60 * 1000);

