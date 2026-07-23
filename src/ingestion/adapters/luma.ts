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
  const out: PersonRef[] = [];
  for (const p of list) {
    if (!p) continue;
    const name = String(
      p.name ||
        p.display_name ||
        p.full_name ||
        [p.first_name, p.last_name].filter(Boolean).join(" "),
    ).trim();
    if (!name) continue;
    out.push({ name, bio: p.bio || p.bio_short || p.headline || p.about || null });
  }
  return out;
}

/** Real attendance from a Luma DETAIL payload. `guest_count` is 0 when the host
 *  hides the guest list, but num_guests / num_tickets_registered still carry it —
 *  take the max integer across those keys (per-tier values are ≤ the total). */
function collectMaxCount(obj: any): number | null {
  const KEYS = new Set(["guest_count", "num_guests", "num_tickets_registered"]);
  let max = 0;
  let found = false;
  const walk = (o: any, d: number) => {
    if (!o || d > 4 || typeof o !== "object") return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (KEYS.has(k) && typeof v === "number" && Number.isFinite(v)) {
        found = true;
        if (v > max) max = v;
      } else if (v && typeof v === "object") {
        walk(v, d + 1);
      }
    }
  };
  walk(obj, 0);
  return found ? max : null;
}

/** Fetch a single event's detail (attendance + real hosts/featured guests). */
async function fetchLumaDetail(
  apiId: string,
): Promise<{ guestCount: number | null; hosts: PersonRef[]; speakers: PersonRef[] } | null> {
  try {
    const d = await getJson(`${BASE}/event/get?event_api_id=${encodeURIComponent(apiId)}`);
    return {
      guestCount: collectMaxCount(d),
      hosts: personRefs(d.hosts),
      speakers: personRefs(d.featured_guests),
    };
  } catch {
    return null; // fail-soft: keep list data for this event
  }
}

/** Run `fn` over items with bounded concurrency. */
async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
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
  if (entries.length > 0 && events.length === 0) {
    // Shape drift signal (§9.3): rows present but none parsed.
    log.warn(`SCHEMA DRIFT? ${source.id} returned ${entries.length} rows, parsed 0`);
  }

  // The list endpoint omits real attendance and full host/guest lists, so enrich
  // each event from its detail endpoint (guest_count/num_guests + hosts +
  // featured_guests). Bounded concurrency; fail-soft per event.
  let enriched = 0;
  await pool(events, 5, async (ev) => {
    const detail = await fetchLumaDetail(ev.source_event_id);
    if (!detail) return;
    if (detail.guestCount != null) ev.guest_count = detail.guestCount;
    if (detail.hosts.length) ev.hosts = detail.hosts;
    if (detail.speakers.length) ev.speakers = detail.speakers;
    if (detail.guestCount != null || detail.hosts.length || detail.speakers.length) enriched++;
  });

  log.info(
    `${source.id}: ${events.length} events from ${entries.length} entries (${enriched} enriched via detail)`,
  );
  return events;
};
