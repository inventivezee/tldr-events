// Eventbrite adapter (PRD Appendix A). Browser scrape of multi-city search URLs.
// Prefers embedded JSON-LD Event data (reliable ISO dates) and falls back to card
// scraping. Best structured source for South Bay; surfaces hackathons.
import type { NormalizedEvent } from "@/types";
import type { FetchFn } from "../types";
import { autoScroll } from "@/lib/browserbase";
import { parseToUtc, parseLoose } from "@/lib/time";
import { categorize } from "../categorize";
import { logger } from "@/lib/logger";

const log = logger("adapter:eventbrite");
const TZ = "America/Los_Angeles";

interface RawEB {
  id: string;
  title: string;
  url: string | null;
  startISO: string | null;
  endISO: string | null;
  whenText: string | null;
  venue: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  canceled: boolean;
}

function idFromUrl(url: string): string | null {
  const m = url.match(/-(\d{6,})(?:\?|$|#)/) || url.match(/\/e\/[^/]*?(\d{6,})/);
  return m ? m[1] : null;
}

function cityFromSearchUrl(url: string): string | null {
  const m = url.match(/\/d\/[a-z]{2}--([a-z-]+)\//i);
  if (!m) return null;
  return m[1]
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const fetchEventbrite: FetchFn = async (source, ctx) => {
  if (!ctx.session) throw new Error("eventbrite requires a browser session");
  const cfg = source.config as { urls: string[] };
  const { page, goto } = ctx.session;

  const byId = new Map<string, NormalizedEvent>();

  for (const url of cfg.urls) {
    const fallbackCity = cityFromSearchUrl(url);
    try {
      await goto(url, { waitMs: 2500 });
      await autoScroll(page, { steps: 5, pauseMs: 700 });

      const raws: RawEB[] = await page.evaluate(() => {
        const results: any[] = [];
        // 1) JSON-LD Event objects (most reliable).
        const scripts = Array.from(
          document.querySelectorAll('script[type="application/ld+json"]'),
        );
        const collect = (node: any) => {
          if (!node || typeof node !== "object") return;
          const type = node["@type"];
          const isEvent =
            type === "Event" ||
            (Array.isArray(type) && type.includes("Event")) ||
            (typeof type === "string" && type.endsWith("Event"));
          if (isEvent && node.name) {
            const loc = node.location || {};
            const addr = loc.address || {};
            results.push({
              kind: "ld",
              title: String(node.name),
              url: node.url || null,
              startISO: node.startDate || null,
              endISO: node.endDate || null,
              whenText: null,
              venue: loc.name || null,
              city: addr.addressLocality || null,
              address: addr.streetAddress || null,
              lat: loc.geo?.latitude ? Number(loc.geo.latitude) : null,
              lng: loc.geo?.longitude ? Number(loc.geo.longitude) : null,
              description: node.description || null,
              canceled:
                node.eventStatus &&
                String(node.eventStatus).toLowerCase().includes("cancel"),
            });
          }
          for (const k of Object.keys(node)) {
            const v = node[k];
            if (Array.isArray(v)) v.forEach(collect);
            else if (v && typeof v === "object") collect(v);
          }
        };
        for (const s of scripts) {
          try {
            collect(JSON.parse(s.textContent || "{}"));
          } catch {
            /* ignore malformed ld+json */
          }
        }
        // 2) Card fallback.
        const cards = Array.from(
          document.querySelectorAll('a[href*="eventbrite.com/e/"]'),
        );
        for (const a of cards) {
          const el = a as HTMLAnchorElement;
          const root = el.closest("[class*='event-card'], article, li") || el;
          const title =
            (root.querySelector("h3")?.textContent || "").trim() ||
            (root.querySelector("h2")?.textContent || "").trim() ||
            (el.getAttribute("aria-label") || "").trim();
          if (!title) continue;
          const ps = Array.from(root.querySelectorAll("p")).map(
            (p) => (p.textContent || "").trim(),
          );
          results.push({
            kind: "card",
            title,
            url: el.href.split("?")[0],
            startISO: null,
            endISO: null,
            whenText: ps[0] || null,
            venue: ps[1] || null,
            city: null,
            address: null,
            lat: null,
            lng: null,
            description: null,
            canceled:
              (root.textContent || "").toLowerCase().includes("cancelled") ||
              (root.textContent || "").toLowerCase().includes("canceled"),
          });
        }
        return results;
      });

      for (const r of raws) {
        if (!r.url) continue;
        const id = idFromUrl(r.url);
        if (!id) continue;
        let starts: Date | null = null;
        try {
          starts = r.startISO
            ? parseToUtc(r.startISO, TZ)
            : r.whenText
              ? parseLoose(r.whenText, TZ)
              : null;
        } catch {
          starts = null;
        }
        if (!starts) continue;
        // Prefer the richer JSON-LD row if we've already seen this id via a card.
        const existing = byId.get(id);
        if (existing && r.startISO === null) continue;
        byId.set(id, {
          source_event_id: id,
          title: r.title,
          url: r.url,
          status: r.canceled ? "canceled" : "active",
          starts_at: starts,
          ends_at: r.endISO ? safeParse(r.endISO) : null,
          region_id: source.regionId ?? "sf_bay",
          venue_name: r.venue,
          address: r.address,
          city: r.city || fallbackCity,
          lat: r.lat,
          lng: r.lng,
          description: r.description,
          categories: categorize(r.title, r.description),
          raw: r,
        });
      }
    } catch (e) {
      log.warn(`${source.id}: url failed ${url}`, e);
    }
  }

  const out = [...byId.values()];
  log.info(`${source.id}: ${out.length} events across ${cfg.urls.length} urls`);
  return out;
};

function safeParse(iso: string): Date | null {
  try {
    return parseToUtc(iso, TZ);
  } catch {
    return null;
  }
}
