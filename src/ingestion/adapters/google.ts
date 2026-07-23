// Google Search adapter (PRD Appendix A, §9.3). Browser scrape via Browserbase
// residential proxy — highest block risk of all sources. Supplies unique
// long-tail / South Bay / Peninsula inventory; heavy overlap with other sources
// is resolved by dedup (§10). Best-effort + fail-partial by design; Google's DOM
// shifts, so extraction prefers robust text over brittle selectors.
import type { NormalizedEvent } from "@/types";
import type { FetchFn } from "../types";
import { sleep } from "@/lib/browserbase";
import { parseLoose } from "@/lib/time";
import { categorize } from "../categorize";
import { logger } from "@/lib/logger";

const log = logger("adapter:google");
const TZ = "America/Los_Angeles";

const PLATFORM_RE =
  /(lu\.ma|luma\.com|eventbrite\.com\/e\/|partiful\.com\/e\/|meetup\.com\/[^/]+\/events\/|cerebralvalley\.ai)/i;

// A date fragment like "Wed, Jul 23" / "July 23, 2026" / "7:00 PM Tue, Aug 5".
const DATE_FRAGMENT_RE =
  /((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?(?:,?\s+\d{1,2}:\d{2}\s*[ap]\.?m\.?)?/i;

export const fetchGoogle: FetchFn = async (source, ctx) => {
  if (!ctx.session) throw new Error("google requires a browser session");
  const cfg = source.config as { queries: string[] };
  const { page, goto } = ctx.session;

  const byId = new Map<string, NormalizedEvent>();

  for (const q of cfg.queries) {
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=us`;
    try {
      await goto(url, { waitMs: 1500 });
      await maybeAcceptConsent(page);
      await sleep(1200);

      const rows: Array<{ title: string; href: string; context: string }> =
        await page.evaluate(() => {
          const out: Array<{ title: string; href: string; context: string }> = [];
          const anchors = Array.from(document.querySelectorAll("a[href]"));
          for (const a of anchors) {
            const el = a as HTMLAnchorElement;
            const href = el.href;
            if (!href || !href.startsWith("http")) continue;
            if (/google\.com|gstatic\.com|googleusercontent/.test(href)) continue;
            const h3 = el.querySelector("h3");
            const title = (h3?.textContent || "").trim();
            if (!title) continue;
            const block = el.closest("div[data-hveid], div.g, div") || el;
            const context = (block.textContent || "").slice(0, 400);
            out.push({ title, href, context });
          }
          return out;
        });

      let added = 0;
      for (const r of rows) {
        if (!PLATFORM_RE.test(r.href)) continue;
        const id = r.href.split(/[?#]/)[0];
        if (byId.has(id)) continue;
        const frag = r.context.match(DATE_FRAGMENT_RE)?.[0] ?? null;
        const starts = frag ? parseLoose(frag, TZ) : null;
        if (!starts) continue; // must be placeable in a window
        byId.set(id, {
          source_event_id: id,
          title: r.title,
          url: r.href,
          status: "active",
          starts_at: starts,
          ends_at: null,
          region_id: source.regionId ?? "sf_bay",
          description: null,
          categories: categorize(r.title, r.context),
          raw: { query: q, ...r },
        });
        added++;
      }
      log.info(`${source.id}: "${q}" → +${added} (from ${rows.length} links)`);
      await sleep(3000); // 3s+ spacing between queries (Appendix A)
    } catch (e) {
      log.warn(`${source.id}: query failed "${q}"`, e);
    }
  }

  const out = [...byId.values()];
  log.info(`${source.id}: ${out.length} placeable events total`);
  return out;
};

async function maybeAcceptConsent(page: import("playwright-core").Page) {
  // Privacy-preserving default: decline/reject where possible; only click a
  // consent control to get past a blocking interstitial to public results.
  try {
    const btn = await page.$(
      'button:has-text("Reject all"), button:has-text("Reject"), form[action*="consent"] button',
    );
    if (btn) await btn.click({ timeout: 3000 });
  } catch {
    /* no consent wall */
  }
}
