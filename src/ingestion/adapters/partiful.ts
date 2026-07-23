// Partiful adapter (PRD Appendix A). Browser scrape reading window.__NEXT_DATA__.
// Social-heavy; the scorer filters for relevance. Times are mixed → naive times
// localized to region tz. Null guest counts → 0 (Appendix C).
import type { NormalizedEvent } from "@/types";
import type { FetchFn } from "../types";
import { parseToUtc } from "@/lib/time";
import { categorize } from "../categorize";
import { logger } from "@/lib/logger";

const log = logger("adapter:partiful");
const TZ = "America/Los_Angeles";

export const fetchPartiful: FetchFn = async (source, ctx) => {
  if (!ctx.session) throw new Error("partiful requires a browser session");
  const cfg = source.config as { url: string };
  const { page, goto } = ctx.session;

  await goto(cfg.url, { waitMs: 3000 });

  const rawEvents: any[] = await page.evaluate(() => {
    const data = (window as any).__NEXT_DATA__;
    const pp = data?.props?.pageProps;
    if (!pp) return [];
    const buckets: any[] = [];
    const push = (arr: any) => {
      if (Array.isArray(arr)) for (const it of arr) if (it?.event) buckets.push(it.event);
    };
    push(pp.trendingSection?.items);
    if (Array.isArray(pp.sections)) for (const s of pp.sections) push(s?.items);
    push(pp.feedItems);
    return buckets;
  });

  const out: NormalizedEvent[] = [];
  const seen = new Set<string>();
  for (const ev of rawEvents) {
    const id = ev?.id || ev?.eventId;
    const title = ev?.title || ev?.name;
    const start = normalizeStart(ev?.startDate ?? ev?.start);
    if (!id || !title || !start) continue;
    if (seen.has(String(id))) continue;
    seen.add(String(id));

    let starts: Date;
    try {
      starts = parseToUtc(start, TZ);
    } catch {
      continue;
    }

    const going = numOr0(ev?.goingGuestCount);
    const interested = numOr0(ev?.interestedGuestCount);
    const venue = ev?.locationInfo?.mapsInfo?.name || ev?.location || null;
    const description = ev?.description || null;

    out.push({
      source_event_id: String(id),
      title: String(title),
      url: `https://partiful.com/e/${id}`,
      status: "active",
      starts_at: starts,
      ends_at: null,
      region_id: source.regionId ?? "sf_bay",
      venue_name: venue,
      city: ev?.locationInfo?.mapsInfo?.city || null,
      description,
      guest_count: going || interested || 0,
      categories: categorize(title, description),
      raw: ev,
    });
  }
  log.info(`${source.id}: ${out.length} events from ${rawEvents.length} raw`);
  return out;
};

function numOr0(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Partiful start may be an ISO string or a {seconds}/{_seconds} timestamp. */
function normalizeStart(v: any): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return new Date(v).toISOString();
  const secs = v.seconds ?? v._seconds;
  if (typeof secs === "number") return new Date(secs * 1000).toISOString();
  return null;
}
