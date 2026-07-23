// Browser automation via Browserbase + residential/managed proxies (PRD §7,
// Appendix A). One session is reused across all browser scrapes AND speaker
// research in a run; navigations are spaced to reduce block rate.
import Browserbase from "@browserbasehq/sdk";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { logger } from "./logger";

const log = logger("browserbase");

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Navigate politely: enforce spacing between navigations, wait for DOM. */
  goto: (url: string, opts?: { waitMs?: number }) => Promise<void>;
  close: () => Promise<void>;
}

/** True when Browserbase credentials are configured. */
export function browserConfigured(): boolean {
  return (
    !!process.env.BROWSERBASE_API_KEY?.trim() &&
    !!process.env.BROWSERBASE_PROJECT_ID?.trim()
  );
}

const MIN_SPACING_MS = 6000; // 5–10s between navigations (Appendix A)

export async function createBrowserSession(): Promise<BrowserSession> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error("BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID not set");
  }

  const bb = new Browserbase({ apiKey });
  // Advanced Stealth Mode better evades fingerprint-based bot detection (e.g.
  // Google's /sorry wall). It requires the Browserbase ENTERPRISE plan — enabling
  // it without that plan returns 403 and fails session creation — so it's opt-in
  // via env and OFF by default. Residential proxies below are ALWAYS on regardless.
  const advancedStealth = process.env.BROWSERBASE_ADVANCED_STEALTH === "true";
  const session = await bb.sessions.create({
    projectId,
    // Residential proxies on EVERY session (US geolocation) — verified residential
    // exit IPs; required for sources that block datacenter IPs.
    proxies: [{ type: "browserbase", geolocation: { country: "US" } }],
    browserSettings: {
      solveCaptchas: false,
      ...(advancedStealth ? { advancedStealth: true } : {}),
    },
  });
  log.info(`session ${session.id} created${advancedStealth ? " (advanced stealth)" : ""}`);

  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(45000);

  // Bundlers (esbuild via tsx, and Next's SWC) inject `__name(fn, "name")` calls
  // into the function bodies we pass to page.evaluate(); that helper is undefined
  // in the browser and throws "__name is not defined". Define a no-op shim before
  // any page script runs. Passed as a STRING so the bundler can't instrument it.
  await context.addInitScript(
    "globalThis.__name = globalThis.__name || function (f) { return f; };",
  );

  let lastNav = 0;
  const goto: BrowserSession["goto"] = async (url, opts) => {
    const since = Date.now() - lastNav;
    if (lastNav && since < MIN_SPACING_MS) {
      await sleep(MIN_SPACING_MS - since);
    }
    log.debug(`goto ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (opts?.waitMs) await sleep(opts.waitMs);
    lastNav = Date.now();
  };

  const close = async () => {
    try {
      await browser.close();
    } catch (e) {
      log.warn("browser close failed", e);
    }
  };

  return { browser, context, page, goto, close };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Auto-scroll a page to trigger lazy loading of cards. */
export async function autoScroll(page: Page, opts?: { steps?: number; pauseMs?: number }) {
  const steps = opts?.steps ?? 8;
  const pauseMs = opts?.pauseMs ?? 700;
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
    await sleep(pauseMs);
  }
}
