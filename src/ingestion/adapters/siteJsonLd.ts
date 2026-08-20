// Standalone event sites that publish schema.org Event JSON-LD.
//
// The gap this closes: a conference with its own domain — Actuate 26, a robotics
// developer conference at Fort Mason — is on no platform we scrape, so nothing
// found it. Rather than write a scraper per conference, this reads the
// structured data such sites already publish for Google's event rich results.
// Pointing at a new conference is then a config line, not code.
//
// Deliberately NOT a browser scrape: JSON-LD sits in the served HTML, so a plain
// fetch is enough and costs no browser session.
import type { NormalizedEvent, PersonRef } from "@/types";
import type { FetchFn } from "../types";
import { parseToUtc } from "@/lib/time";
import { categorize } from "../categorize";
import { keepForBayArea } from "@/lib/region";
import { logger } from "@/lib/logger";

const log = logger("adapter:site-jsonld");

interface LdPlace {
  name?: string;
  address?: { addressLocality?: string; streetAddress?: string; addressRegion?: string } | string;
}
interface LdEvent {
  "@type"?: string | string[];
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  location?: LdPlace | LdPlace[];
  performer?: unknown;
  organizer?: unknown;
}

/** Every JSON-LD node in a page, flattened through @graph and arrays. */
function ldNodes(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(
    /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue; // one malformed block shouldn't hide the rest
    }
    const stack = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        stack.push(...node);
      } else if (node && typeof node === "object") {
        const rec = node as Record<string, unknown>;
        out.push(rec);
        if (Array.isArray(rec["@graph"])) stack.push(...(rec["@graph"] as unknown[]));
      }
    }
  }
  return out;
}

function isEvent(node: Record<string, unknown>): boolean {
  const t = node["@type"];
  const types = Array.isArray(t) ? t : [t];
  // Subtypes are common and all fine: BusinessEvent, EducationEvent, Festival…
  return types.some((x) => typeof x === "string" && /event$/i.test(x));
}

function names(v: unknown): PersonRef[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  const out: PersonRef[] = [];
  for (const p of list) {
    const name =
      typeof p === "string" ? p : ((p as { name?: string } | null)?.name ?? "");
    const clean = String(name).trim();
    if (clean) out.push({ name: clean, bio: null });
  }
  return out;
}

function place(loc: LdEvent["location"]): { venue: string | null; city: string | null; address: string | null } {
  const first = Array.isArray(loc) ? loc[0] : loc;
  if (!first) return { venue: null, city: null, address: null };
  if (typeof first === "string") return { venue: first, city: first, address: first };
  const addr = first.address;
  if (typeof addr === "string") {
    return { venue: first.name ?? null, city: addr, address: addr };
  }
  const city = addr?.addressLocality ?? null;
  const full = [addr?.streetAddress, city, addr?.addressRegion].filter(Boolean).join(", ");
  return { venue: first.name ?? null, city, address: full || null };
}

export const fetchSiteJsonLd: FetchFn = async (source) => {
  const cfg = (source.config ?? {}) as { urls?: string[]; url?: string };
  const urls = cfg.urls ?? (cfg.url ? [cfg.url] : []);
  if (!urls.length) throw new Error(`site_jsonld ${source.id} has no url(s) configured`);

  const events: NormalizedEvent[] = [];
  let outOfRegion = 0;

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        log.warn(`${source.id}: ${res.status} for ${url}`);
        continue;
      }
      const html = await res.text();
      const found = ldNodes(html).filter(isEvent) as unknown as LdEvent[];
      if (!found.length) {
        // Worth surfacing: the site either dropped its markup or changed shape.
        log.warn(`${source.id}: no Event JSON-LD at ${url}`);
        continue;
      }

      for (const ev of found) {
        if (!ev.name || !ev.startDate) continue;
        const { venue, city, address } = place(ev.location);
        if (!keepForBayArea(city, address, venue)) {
          outOfRegion++;
          continue;
        }
        const description = ev.description ? String(ev.description).slice(0, 6000) : null;
        events.push({
          // The event's own page is its identity; these sites have no ids.
          source_event_id: ev.url || url,
          title: String(ev.name).trim(),
          url: ev.url || url,
          status: "active",
          starts_at: parseToUtc(String(ev.startDate)),
          ends_at: ev.endDate ? parseToUtc(String(ev.endDate)) : null,
          region_id: source.regionId ?? "sf_bay",
          venue_name: venue,
          address,
          city,
          lat: null,
          lng: null,
          description,
          hosts: names(ev.organizer),
          speakers: names(ev.performer),
          guest_count: null,
          categories: categorize(ev.name, description),
          raw: ev as unknown as Record<string, unknown>,
        });
      }
    } catch (e) {
      // One bad site must not fail the whole source.
      log.warn(`${source.id}: failed on ${url}`, e);
    }
  }

  log.info(
    `${source.id}: ${events.length} events from ${urls.length} site(s)` +
      (outOfRegion ? ` (${outOfRegion} outside the Bay Area)` : ""),
  );
  return events;
};
