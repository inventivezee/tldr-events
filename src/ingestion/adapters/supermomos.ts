// Supermomos adapter (SF community events). Browser scrape reading the Next.js
// __NEXT_DATA__ React-Query cache — structured event objects (title, ISO
// eventTimestamp, venueData, hosts, speakers). Small but high-signal source:
// curated founder/investor/operator dinners and salons.
import type { NormalizedEvent, PersonRef } from "@/types";
import type { FetchFn } from "../types";
import { parseToUtc } from "@/lib/time";
import { categorize } from "../categorize";
import { logger } from "@/lib/logger";

const log = logger("adapter:supermomos");

export const fetchSupermomos: FetchFn = async (source, ctx) => {
  if (!ctx.session) throw new Error("supermomos requires a browser session");
  const cfg = source.config as { url: string };
  const { page, goto } = ctx.session;

  await goto(cfg.url, { waitMs: 3500 });

  // Walk the dehydrated React-Query cache for arrays of event objects.
  const rawEvents: any[] = await page.evaluate(() => {
    const data = (window as any).__NEXT_DATA__;
    const queries = data?.props?.pageProps?.dehydratedState?.queries ?? [];
    const out: any[] = [];
    const seen = new Set<string>();
    const isEvent = (o: any) =>
      o && typeof o === "object" && o.title && (o.eventTimestamp || o.eventEndTimestamp);
    const visit = (node: any, depth: number) => {
      if (!node || depth > 8) return;
      if (Array.isArray(node)) {
        if (node.some(isEvent)) {
          for (const e of node) {
            if (isEvent(e) && !seen.has(e.id)) {
              seen.add(e.id);
              out.push(e);
            }
          }
          return;
        }
        for (const v of node) visit(v, depth + 1);
        return;
      }
      if (typeof node === "object") for (const k of Object.keys(node)) visit(node[k], depth + 1);
    };
    for (const q of queries) visit(q?.state?.data, 0);
    return out;
  });

  const people = (list: any): PersonRef[] => {
    if (!Array.isArray(list)) return [];
    return list
      .filter((p) => p && (p.displayName || p.name))
      .map((p) => {
        const name = String(p.displayName || p.name).trim();
        const title = p.curPosition?.title;
        const org = p.curPosition?.organization?.name;
        const bio = [title, org].filter(Boolean).join(" at ") || null;
        return { name, bio };
      })
      .filter((p) => p.name.length > 0);
  };

  const out: NormalizedEvent[] = [];
  const seen = new Set<string>();
  for (const ev of rawEvents) {
    const id = ev.id || ev.slug;
    const start = ev.eventTimestamp;
    if (!id || !ev.title || !start) continue;
    if (seen.has(String(id))) continue;
    seen.add(String(id));

    let starts: Date;
    try {
      starts = parseToUtc(start);
    } catch {
      continue;
    }

    const venue = ev.venueData || {};
    const description: string | null = ev.description || null;
    const online = ev.isOnline === true;

    out.push({
      source_event_id: String(id),
      title: String(ev.title),
      url: ev.slug ? `https://www.supermomos.com/events/${ev.slug}` : cfg.url,
      status: "active",
      starts_at: starts,
      ends_at: ev.eventEndTimestamp ? safe(ev.eventEndTimestamp) : null,
      region_id: source.regionId ?? "sf_bay",
      venue_name: venue.maskedVenue || venue.name || null,
      address: venue.address || null,
      city: online ? "Virtual" : venue.city || null,
      lat: venue.coordinate?.lat ?? venue.coordinate?.latitude ?? null,
      lng: venue.coordinate?.lng ?? venue.coordinate?.longitude ?? null,
      description,
      hosts: people(ev.hosts),
      speakers: people(ev.speakers),
      guest_count: typeof ev.maxCapacity === "number" ? ev.maxCapacity : null,
      categories: categorize(ev.title, description),
      raw: ev,
    });
  }

  log.info(`${source.id}: ${out.length} events from ${rawEvents.length} raw`);
  return out;
};

function safe(iso: string): Date | null {
  try {
    return parseToUtc(iso);
  } catch {
    return null;
  }
}
