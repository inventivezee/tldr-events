// Shared Luma detail-endpoint helpers. Used by the Luma adapter (enrich its own
// list rows) AND the cross-source backfill (enrich lu.ma links that arrived via
// Cerebral Valley / Google / etc., which never hit the Luma list endpoint).
// The detail endpoint `event/get?event_api_id=<x>` accepts BOTH the api_id and
// the public URL slug/short-code, so any lu.ma URL can be resolved.
import type { NormalizedEvent, PersonRef } from "@/types";

export const BASE = process.env.LUMA_API_BASE || "https://api.lu.ma";

export async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
    // Bound each request so a stalled connection can't eat the cron time budget.
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Luma ${res.status} for ${url}`);
  return res.json();
}

export function personRefs(list: any): PersonRef[] {
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
export function collectMaxCount(obj: any): number | null {
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

/** Fetch a single event's detail (attendance + real hosts/featured guests + the
 *  exact start/end instants). `idOrSlug` may be a Luma api_id OR a public URL
 *  slug/short-code. */
export async function fetchLumaDetail(idOrSlug: string): Promise<{
  guestCount: number | null;
  hosts: PersonRef[];
  speakers: PersonRef[];
  startsAt: Date | null;
  endsAt: Date | null;
} | null> {
  try {
    const d = await getJson(
      `${BASE}/event/get?event_api_id=${encodeURIComponent(idOrSlug)}`,
    );
    const ev = d?.event ?? d;
    const when = (v: unknown): Date | null => {
      if (typeof v !== "string") return null;
      const t = new Date(v);
      return Number.isNaN(t.getTime()) ? null : t;
    };
    return {
      guestCount: collectMaxCount(d),
      hosts: personRefs(d.hosts),
      speakers: personRefs(d.featured_guests),
      startsAt: when(ev?.start_at),
      endsAt: when(ev?.end_at),
    };
  } catch {
    return null; // fail-soft: keep whatever data we already have
  }
}

/** The lu.ma slug/short-code from an event URL, or null if it isn't a Luma link.
 *  Handles lu.ma and luma.com; ignores listing roots (e.g. luma.com/sf). */
export function lumaSlugFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "lu.ma" && host !== "luma.com") return null;
    const seg = u.pathname.split("/").filter(Boolean);
    // First path segment is the event slug/code; must exist and look like one.
    const slug = seg[0];
    if (!slug || slug.length < 3) return null;
    // Skip known non-event roots.
    if (["discover", "u", "calendar", "embed"].includes(slug.toLowerCase())) return null;
    return slug;
  } catch {
    return null;
  }
}

/** Enrich normalized events IN PLACE with Luma attendance + hosts/guests, for any
 *  event whose URL is a lu.ma link and that arrived WITHOUT a count. Runs for every
 *  source in the ingestion runner, so lu.ma events pulled via Cerebral Valley /
 *  Google (which never hit the Luma list endpoint) get their real numbers at
 *  ingest time — before content_hash is computed, so the count persists across
 *  re-ingests and drives scoring. Luma-sourced events already carry a count and
 *  are skipped. Fail-soft per event. Returns how many were enriched. */
export async function enrichLumaEvents(
  events: NormalizedEvent[],
  concurrency = 5,
): Promise<number> {
  let enriched = 0;
  await pool(events, concurrency, async (ev) => {
    // Worth a lookup if attendance is missing OR the listing only gave a date
    // (midnight local ⇒ no time was published on the aggregator card).
    const needsCount = ev.guest_count == null || ev.guest_count === 0;
    const needsTime = isPlaceholderTime(ev.starts_at);
    if (!needsCount && !needsTime) return;
    const slug = lumaSlugFromUrl(ev.url);
    if (!slug) return;
    const d = await fetchLumaDetail(slug);
    if (!d) return;
    let touched = false;
    // Only override a date-only placeholder — never second-guess a real time
    // that the source actually published.
    if (needsTime && d.startsAt) {
      ev.starts_at = d.startsAt;
      if (d.endsAt) ev.ends_at = d.endsAt;
      touched = true;
    }
    if (d.guestCount != null && d.guestCount > (ev.guest_count ?? 0)) {
      ev.guest_count = d.guestCount;
      touched = true;
    }
    if (!(ev.hosts?.length ?? 0) && d.hosts.length) {
      ev.hosts = d.hosts;
      touched = true;
    }
    if (!(ev.speakers?.length ?? 0) && d.speakers.length) {
      ev.speakers = d.speakers;
      touched = true;
    }
    if (touched) enriched++;
  });
  return enriched;
}

/** True when a timestamp looks like a date with no time attached, so the 00:00 is
 *  a placeholder rather than a real start.
 *
 *  Checks BOTH local and UTC midnight. A listing that publishes only a date can
 *  land on either, depending on whether the date string was resolved in the
 *  region's zone or in UTC — and a UTC-midnight placeholder is the nastier case,
 *  since it reads as 5pm on the PREVIOUS day in Pacific and moves the event to
 *  the wrong day entirely. Over-matching is harmless here: the only thing we do
 *  with it is take Luma's authoritative time for a Luma event. */
export function isPlaceholderTime(d: Date | null | undefined, tz = "America/Los_Angeles"): boolean {
  if (!d) return false;
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value;
  const m = parts.find((p) => p.type === "minute")?.value;
  return (h === "00" || h === "24") && m === "00";
}

/** Run `fn` over items with bounded concurrency. */
export async function pool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]);
      }
    },
  );
  await Promise.all(workers);
}
