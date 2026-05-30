import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const DEFAULT_VIEWPORT = { width: 1400, height: 900 };

function useChromiumSandbox() {
  return (
    process.env.LINKEDIN_CHROMIUM_SANDBOX === "1" ||
    (process.env.LINKEDIN_CHROMIUM_SANDBOX !== "0" &&
      (process.platform === "win32" || process.platform === "darwin"))
  );
}

function buildLaunchOptions({ forInstalledBrowser }) {
  const ignoreDefaultArgs = ["--enable-automation", "--no-sandbox"];
  const args = [];

  // Real Chrome/Edge warn about this flag; use only for bundled Chromium fallback.
  const stealth =
    !forInstalledBrowser || process.env.LINKEDIN_STEALTH_ARGS === "1";
  if (stealth && !forInstalledBrowser) {
    args.push("--disable-blink-features=AutomationControlled");
  }

  return {
    headless: false,
    viewport: DEFAULT_VIEWPORT,
    ignoreDefaultArgs,
    args,
    ...(useChromiumSandbox() ? { chromiumSandbox: true } : {}),
  };
}

/**
 * Launch a persistent browser for LinkedIn login/scraping.
 * Prefer installed Google Chrome (channel: chrome) — LinkedIn often blocks Playwright Chromium.
 */
export async function launchLinkedInContext(profileDir, overrides = {}) {
  await mkdir(profileDir, { recursive: true });

  const channel = (process.env.LINKEDIN_BROWSER_CHANNEL ?? "chrome").trim().toLowerCase();

  if (channel && channel !== "chromium") {
    try {
      console.log(`Opening browser: ${channel} (installed)`);
      return await chromium.launchPersistentContext(profileDir, {
        ...buildLaunchOptions({ forInstalledBrowser: true }),
        channel,
        ...overrides,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `Could not start "${channel}". Install Google Chrome or set LINKEDIN_BROWSER_CHANNEL=msedge. Falling back to Chromium.\n  ${msg}`,
      );
    }
  }

  console.log("Opening browser: Chromium (bundled). If LinkedIn blocks login, install Chrome.");
  return chromium.launchPersistentContext(profileDir, {
    ...buildLaunchOptions({ forInstalledBrowser: false }),
    ...overrides,
  });
}
