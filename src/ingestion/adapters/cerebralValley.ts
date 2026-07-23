// Cerebral Valley adapter (PRD Appendix A). Browser scrape. Overlaps Luma
// (good enrichment, AI-skewed). Selectors follow the recipe; DOM can drift, so
// extraction is defensive and monitored (empty result on non-empty page = drift).
import type { NormalizedEvent } from "@/types";
import type { FetchFn } from "../types";
import { autoScroll } from "@/lib/browserbase";
import { parseLoose } from "@/lib/time";
import { categorize } from "../categorize";
import { logger } from "@/lib/logger";

const log = logger("adapter:cerebral_valley");
const TZ = "America/Los_Angeles";

interface RawCard {
  title: string;
  href: string | null;
  when: string | null;
  location: string | null;
  description: string | null;
}

export const fetchCerebralValley: FetchFn = async (source, ctx) => {
  if (!ctx.session) throw new Error("cerebral_valley requires a browser session");
  const cfg = source.config as { url: string };
  const { page, goto } = ctx.session;

  await goto(cfg.url, { waitMs: 2500 });
  await autoScroll(page, { steps: 10, pauseMs: 800 });

  const cards: RawCard[] = await page.evaluate(() => {
    const pick = (root: Element, sel: string) =>
      (root.querySelector(sel)?.textContent || "").trim() || null;
    const anchors = Array.from(
      document.querySelectorAll('a[aria-label^="Open event:"]'),
    );
    // Fallback: any anchor to an event route if the aria-label scheme changes.
    const nodes =
      anchors.length > 0
        ? anchors
        : Array.from(document.querySelectorAll("a[href*='/events/']"));
    return nodes.map((a) => {
      const el = a as HTMLAnchorElement;
      const root = el.closest("[class*='card'], article, li") || el;
      const label = el.getAttribute("aria-label") || "";
      const title =
        pick(root, "h3") ||
        pick(root, "h2") ||
        label.replace(/^Open event:\s*/i, "").trim() ||
        (el.textContent || "").trim();
      return {
        title,
        href: el.href || null,
        when:
          pick(root, "time") ||
          pick(root, "[class*='date']") ||
          pick(root, "[class*='time']"),
        location: pick(root, "[class*='location']") || pick(root, "[class*='venue']"),
        description: pick(root, "p"),
      };
    });
  });

  const out: NormalizedEvent[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    if (!c.title || !c.href) continue;
    const starts = c.when ? parseLoose(c.when, TZ) : null;
    if (!starts) continue; // need a real date
    const id = c.href.split("?")[0];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      source_event_id: id,
      title: c.title,
      url: c.href,
      status: "active",
      starts_at: starts,
      ends_at: null,
      region_id: source.regionId ?? "sf_bay",
      venue_name: c.location,
      city: c.location,
      description: c.description,
      categories: categorize(c.title, c.description),
      raw: c,
    });
  }
  log.info(`${source.id}: ${out.length} events from ${cards.length} cards`);
  if (cards.length > 0 && out.length === 0) {
    log.warn(`SCHEMA DRIFT? ${source.id}: ${cards.length} cards, parsed 0`);
  }
  return out;
};
