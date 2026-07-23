// Shared Luma detail-endpoint helpers. Used by the Luma adapter (enrich its own
// list rows) AND the cross-source backfill (enrich lu.ma links that arrived via
// Cerebral Valley / Google / etc., which never hit the Luma list endpoint).
// The detail endpoint `event/get?event_api_id=<x>` accepts BOTH the api_id and
// the public URL slug/short-code, so any lu.ma URL can be resolved.
import type { PersonRef } from "@/types";

export const BASE = process.env.LUMA_API_BASE || "https://api.lu.ma";

export async function getJson(url: string): Promise<any> {
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

/** Fetch a single event's detail (attendance + real hosts/featured guests).
 *  `idOrSlug` may be a Luma api_id OR a public URL slug/short-code. */
export async function fetchLumaDetail(
  idOrSlug: string,
): Promise<{ guestCount: number | null; hosts: PersonRef[]; speakers: PersonRef[] } | null> {
  try {
    const d = await getJson(
      `${BASE}/event/get?event_api_id=${encodeURIComponent(idOrSlug)}`,
    );
    return {
      guestCount: collectMaxCount(d),
      hosts: personRefs(d.hosts),
      speakers: personRefs(d.featured_guests),
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
