// Cerebral Valley adapter (PRD Appendix A). Browser scrape. Overlaps Luma
// (good enrichment, AI-skewed). CV renders each event as an
// `a[aria-label^="Open event:"]` anchor whose detail column has ordered lines:
//   title / "Wed, Jul 22 · 8:00 AM PDT" / <badge> / venue / description
// The href is the external event URL. DOM can drift → extraction is defensive and
// monitored (empty result on a non-empty page = drift).
import type { NormalizedEvent } from "@/types";
import type { FetchFn } from "../types";
import { autoScroll } from "@/lib/browserbase";
import { parseLoose } from "@/lib/time";
import { categorize } from "../categorize";
import { normalizeText } from "@/lib/text";
import { logger } from "@/lib/logger";

const log = logger("adapter:cerebral_valley");
const TZ = "America/Los_Angeles";

const BADGE = /^(live|in person|in-person|virtual|online|hybrid|sold out|free|paid)$/i;
const DATETIME_RE =
  /([A-Za-z]{3,},?\s+[A-Za-z]{3,}\.?\s+\d{1,2})\s*·\s*(\d{1,2}:\d{2}\s*[AP]M)/i;

interface RawCard {
  title: string;
  href: string | null;
  lines: string[];
}

export const fetchCerebralValley: FetchFn = async (source, ctx) => {
  if (!ctx.session) throw new Error("cerebral_valley requires a browser session");
  const cfg = source.config as { url: string };
  const { page, goto } = ctx.session;

  await goto(cfg.url, { waitMs: 2500 });
  await autoScroll(page, { steps: 12, pauseMs: 800 });

  const cards: RawCard[] = await page.evaluate(() => {
    const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
    const anchors = Array.from(document.querySelectorAll('a[aria-label^="Open event:"]'));
    return anchors.map((a) => {
      const el = a as HTMLAnchorElement;
      // The full event row (.flex.flex-col) holds the ordered lines incl. venue
      // + description; the inner min-w-0 column has only title/date/badge.
      const col =
        (el.closest("div.flex.flex-col") as HTMLElement | null) ??
        (el.closest("div.min-w-0") as HTMLElement | null) ??
        el.parentElement;
      const title =
        clean(el.querySelector("h3")?.textContent) ||
        clean(el.getAttribute("aria-label")).replace(/^Open event:\s*/i, "");
      const lines = ((col?.innerText as string) || "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
      return { title, href: el.href || null, lines };
    });
  });

  const out: NormalizedEvent[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    if (!c.title || !c.href) continue;

    // Find the date/time line and parse it (Bay Area → America/Los_Angeles, DST-correct).
    const dtLine = c.lines.find((l) => DATETIME_RE.test(l));
    const m = dtLine?.match(DATETIME_RE);
    const starts = m ? parseLoose(`${m[1]}, ${m[2]}`, TZ) : null;
    if (!starts) continue; // require a real date to place the event in a window

    const id = c.href.split("?")[0];
    if (seen.has(id)) continue;
    seen.add(id);

    // Venue = first non-badge line after the date/time; description = last long line.
    const dtIdx = dtLine ? c.lines.indexOf(dtLine) : -1;
    let venue: string | null = null;
    for (let i = dtIdx + 1; i < c.lines.length; i++) {
      const l = c.lines[i];
      if (BADGE.test(l)) continue;
      venue = l;
      break;
    }
    const description =
      c.lines.find((l) => l.length > 60) ?? c.lines[c.lines.length - 1] ?? null;

    out.push({
      source_event_id: id,
      title: c.title,
      url: c.href,
      status: "active",
      starts_at: starts,
      ends_at: null,
      region_id: source.regionId ?? "sf_bay",
      venue_name: venue,
      city: cityFromVenue(venue),
      description,
      categories: categorize(c.title, description),
      raw: c,
    });
  }

  log.info(`${source.id}: ${out.length} events from ${cards.length} cards`);
  if (cards.length > 0 && out.length === 0) {
    log.warn(`SCHEMA DRIFT? ${source.id}: ${cards.length} cards, parsed 0`);
  }
  return out;
};

const BAY_CITIES = [
  "san francisco", "sf", "oakland", "berkeley", "palo alto", "mountain view",
  "menlo park", "redwood city", "san jose", "sunnyvale", "santa clara",
  "cupertino", "half moon bay", "san mateo", "fremont", "emeryville",
];

/** Best-effort city from a venue string ("San Francisco, CA" → "San Francisco"). */
function cityFromVenue(venue: string | null): string | null {
  if (!venue) return null;
  const commaCA = venue.match(/^(.*?),\s*CA\b/i);
  if (commaCA) return commaCA[1].trim();
  const norm = normalizeText(venue);
  const hit = BAY_CITIES.find((c) => norm === c || norm.includes(c));
  if (hit) return venue;
  return null;
}
