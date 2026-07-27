// Evion adapter (evion.app/events). Browser scrape of a Vite SPA — no server
// -rendered HTML and no JSON endpoint to call, so the event cards are read from
// the DOM after render.
//
// Evion is itself an AGGREGATOR ("500+ live events searched daily from over 100+
// platforms"), and its cards link out to the ORIGINAL event page (lu.ma/…,
// partiful.com/…, a conference's own site). That is a good fit for us: rows that
// duplicate Luma/Partiful events we already hold collapse in dedup Stage 0 (same
// event URL), so what this source actually contributes is Evion-hosted events
// plus the long tail from platforms we don't scrape directly.
//
// The listing is geo-sensitive ("prioritized near you") and our browser runs
// through residential proxies whose exit location varies, so every row is checked
// against a Bay Area allowlist before it is emitted — otherwise an out-of-region
// event would be stored tagged with this source's region.
import type { NormalizedEvent } from "@/types";
import type { FetchFn } from "../types";
import { parseToUtc } from "@/lib/time";
import { categorize } from "../categorize";
import { logger } from "@/lib/logger";

const log = logger("adapter:evion");

/** Bay Area place names as they appear in Evion's location line. */
const BAY_AREA =
  /(bay area|san francisco|^sf\b|\bsf\b|oakland|berkeley|palo alto|menlo park|mountain view|san jose|santa clara|sunnyvale|redwood city|stanford|cupertino|los altos|emeryville|alameda|hayward|fremont|burlingame|san mateo|foster city|milpitas|campbell|saratoga|los gatos|belmont|daly city|richmond, ca|marin|sausalito|south san francisco|brisbane|colma|pacifica|union city|newark, ca|walnut creek|pleasanton|dublin, ca|livermore|san carlos|atherton|woodside|portola valley|half moon bay|san bruno|millbrae)/i;

interface RawCard {
  url: string;
  platform: string | null;
  title: string;
  dateText: string;
  timeText: string | null;
  location: string | null;
  registered: number | null;
  tags: string[];
}

export const fetchEvion: FetchFn = async (source, ctx) => {
  if (!ctx.session) throw new Error("evion requires a browser session");
  const cfg = (source.config ?? {}) as { url?: string };
  const { page, goto } = ctx.session;

  await goto(cfg.url || "https://evion.app/events/", { waitMs: 4000 });

  const cards: RawCard[] = await page.evaluate(() => {
    const DATE_RE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;
    const TIME_RE = /^\d{1,2}:\d{2}\s?(AM|PM)$/i;
    const REG_RE = /^([\d,]+)\s+registered$/i;

    const out: RawCard[] = [];
    const seen = new Set<string>();
    const anchors = Array.from(document.querySelectorAll("a")).filter((a) =>
      /view event|view details/i.test(a.textContent || ""),
    );

    for (const a of anchors) {
      const href = (a as HTMLAnchorElement).href;
      if (!href || seen.has(href)) continue;

      // Resolve this anchor's own card: climb to the LARGEST ancestor that still
      // contains exactly one "view" link. Stopping at the first date line would
      // escape a dateless card into the grid and pick up a sibling's title;
      // matching a fixed class would miss the differently-wrapped featured card.
      const isViewLink = (el: Element) =>
        /view event|view details/i.test(el.textContent || "");
      let card: HTMLElement | null = null;
      let cur = (a as HTMLElement).parentElement;
      for (let i = 0; i < 6 && cur; i++) {
        const views = Array.from(cur.querySelectorAll("a")).filter(isViewLink);
        if (views.length > 1) break; // spans more than one card — too far
        card = cur;
        cur = cur.parentElement;
      }
      if (!card) continue;
      const lines = (card.innerText || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      // No date on the card → nothing to schedule it against; skip rather than
      // guess (some listings are evergreen "register now" conference ads).
      const di = lines.findIndex((l) => DATE_RE.test(l));
      if (di < 0) continue;

      // Title: the most substantial line above the date (badges/prices are short).
      const above = lines.slice(0, di).filter((l) => !/^from \$/i.test(l));
      if (!above.length) continue;
      const title = above.reduce((a2, b) => (b.length > a2.length ? b : a2), "");
      if (!title || title.length < 3) continue;

      const after = lines.slice(di + 1);
      const timeText = after[0] && TIME_RE.test(after[0]) ? after[0] : null;
      const rest = timeText ? after.slice(1) : after;
      const location = rest.find((l) => /,|bay area/i.test(l)) ?? null;
      const regLine = lines.find((l) => REG_RE.test(l));
      const registered = regLine
        ? Number(regLine.replace(/,/g, "").match(/\d+/)?.[0] ?? "")
        : null;

      // Short lowercase-ish lines below the title behave as tags ("ai", "tech").
      const tags = rest.filter((l) => /^[a-z0-9 &/-]{2,20}$/.test(l) && l !== location);

      seen.add(href);
      out.push({
        url: href,
        platform: above[0] && above[0] !== title ? above[0] : null,
        title,
        dateText: lines[di],
        timeText,
        location,
        registered: Number.isFinite(registered as number) ? registered : null,
        tags,
      });
    }
    return out;
  });

  const events: NormalizedEvent[] = [];
  let skippedRegion = 0;
  for (const c of cards) {
    try {
      if (!c.location || !BAY_AREA.test(c.location)) {
        skippedRegion++;
        continue;
      }
      // "Jul 27, 2026" + optional "6:30 PM", interpreted in the region's tz.
      const stamp = c.timeText ? `${c.dateText} ${c.timeText}` : c.dateText;
      const startsAt = parseToUtc(stamp, "America/Los_Angeles");
      if (!startsAt || Number.isNaN(startsAt.getTime())) continue;

      const description = c.tags.length ? c.tags.join(", ") : null;
      events.push({
        // The outbound URL is the event's real identity here (Evion mostly
        // relists other platforms), so it doubles as the per-source id.
        source_event_id: c.url,
        title: c.title,
        url: c.url,
        status: "active",
        starts_at: startsAt,
        ends_at: null,
        region_id: source.regionId ?? "sf_bay",
        venue_name: null,
        address: null,
        city: c.location,
        lat: null,
        lng: null,
        description,
        hosts: [],
        speakers: [],
        guest_count: c.registered,
        categories: categorize(c.title, description),
        raw: c,
      });
    } catch (e) {
      log.warn(`skip malformed evion card: ${c.title}`, e);
    }
  }

  if (cards.length > 0 && events.length === 0) {
    log.warn(`SCHEMA DRIFT? evion returned ${cards.length} cards, parsed 0`);
  }
  log.info(
    `${source.id}: ${events.length} events from ${cards.length} cards (${skippedRegion} outside the Bay Area)`,
  );
  return events;
};
