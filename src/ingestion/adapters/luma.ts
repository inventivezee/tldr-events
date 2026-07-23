// Luma adapter (PRD Appendix A). HTTP API — the feed's backbone. Handles both
// `luma_discover` (place) and `luma_calendar` (calendar) sources. Luma times are
// UTC. Internal endpoints can drift (§9.3): we validate response shape, retain
// raw, and fail per-source. Base host is overridable via LUMA_API_BASE.
import type { NormalizedEvent, PersonRef } from "@/types";
import type { SourceRow } from "@/db/schema";
import type { FetchFn } from "../types";
import { parseToUtc } from "@/lib/time";
import { categorize } from "../categorize";
import { logger } from "@/lib/logger";

const log = logger("adapter:luma");
const BASE = process.env.LUMA_API_BASE || "https://api.lu.ma";
const MAX_PAGES = 6;

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`Luma ${res.status} for ${url}`);
  return res.json();
}

/** Pull the event-bearing rows from a paginated response, tolerant of shape drift. */
function extractEntries(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function personRefs(list: any): PersonRef[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && (p.name || p.display_name || p.full_name))
    .map((p) => ({
      name: String(p.name || p.display_name || p.full_name).trim(),
      bio: p.bio || p.headline || p.about || null,
    }))
    .filter((p) => p.name.length > 0);
}

export function parseLumaEntry(source: SourceRow, entry: any): NormalizedEvent | null {
  // An entry may be {event, hosts, featured_guests,...} or the event itself.
  const ev = entry?.event ?? entry;
  if (!ev) return null;
  const id = ev.api_id || ev.id || entry?.api_id;
  const name = ev.name || ev.title;
  const start = ev.start_at || ev.starts_at || ev.start;
  if (!id || !name || !start) return null;

  const geo = ev.geo_address_info || ev.geo || {}; // may be null → default {}
  const slug = typeof ev.url === "string" ? ev.url : null;
  const fullUrl = slug
    ? slug.startsWith("http")
      ? slug
      : `https://lu.ma/${slug}`
    : ev.full_url || null;

  const hosts = personRefs(entry?.hosts ?? ev.hosts);
  const guests = personRefs(entry?.featured_guests ?? ev.featured_guests);

  const description =
    ev.description || ev.description_md || ev.one_liner || null;

  const status =
    ev.status === "canceled" || ev.cancelled || ev.is_canceled
      ? "canceled"
      : "active";

  return {
    source_event_id: String(id),
    title: String(name).trim(),
    url: fullUrl,
    status,
    starts_at: parseToUtc(String(start)),
    ends_at: ev.end_at ? parseToUtc(String(ev.end_at)) : null,
    region_id: source.regionId ?? "sf_bay",
    venue_name: geo?.name || geo?.address || null,
    address: geo?.full_address || geo?.address || null,
    city: geo?.city || geo?.city_state || null,
    lat: numOrNull(geo?.latitude),
    lng: numOrNull(geo?.longitude),
    description,
    hosts,
    speakers: guests,
    guest_count: numOrNull(ev.guest_count ?? ev.registration_count),
    categories: categorize(name, description),
    raw: entry,
  };
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function paginate(baseUrl: string): Promise<any[]> {
  const out: any[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = cursor ? `${baseUrl}&pagination_cursor=${encodeURIComponent(cursor)}` : baseUrl;
    const payload = await getJson(url);
    const entries = extractEntries(payload);
    out.push(...entries);
    const hasMore = payload?.has_more ?? payload?.hasMore ?? false;
    cursor = payload?.next_cursor || payload?.nextCursor || "";
    if (!hasMore || !cursor || entries.length === 0) break;
  }
  return out;
}

export const fetchLuma: FetchFn = async (source) => {
  const cfg = source.config as Record<string, string>;
  let baseUrl: string;
  if (source.kind === "luma_discover") {
    if (!cfg.place_id) throw new Error(`luma_discover ${source.id} missing place_id`);
    baseUrl = `${BASE}/discover/get-paginated-events?discover_place_api_id=${encodeURIComponent(cfg.place_id)}&pagination_limit=50`;
  } else {
    if (!cfg.cal_id) throw new Error(`luma_calendar ${source.id} missing cal_id`);
    baseUrl = `${BASE}/calendar/get-items?calendar_api_id=${encodeURIComponent(cfg.cal_id)}&pagination_limit=50&period=future`;
  }

  const entries = await paginate(baseUrl);
  const events: NormalizedEvent[] = [];
  for (const entry of entries) {
    try {
      const ev = parseLumaEntry(source, entry);
      if (ev) events.push(ev);
    } catch (e) {
      log.warn(`skip malformed entry in ${source.id}`, e);
    }
  }
  log.info(`${source.id}: ${events.length} events from ${entries.length} entries`);
  if (entries.length > 0 && events.length === 0) {
    // Shape drift signal (§9.3): rows present but none parsed.
    log.warn(`SCHEMA DRIFT? ${source.id} returned ${entries.length} rows, parsed 0`);
  }
  return events;
};
