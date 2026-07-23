// Web read layer (PRD §13). Reads the same store; no schema change. Returns the
// delivered shortlist for "this week" / "next week", tier-grouped, filterable by
// niche (scores.category_tag) and tier.
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import {
  dayWindow,
  thisWeekWindow,
  nextWeekWindow,
  type UtcWindow,
} from "@/lib/time";
import { queryDeliveryEvents, type DeliveryEvent } from "@/digest/query";
import type { Tier } from "@/types";
import { TIER_ORDER } from "@/scoring/tiers";
import { FEED_ID } from "@/seed/data";
import { clickPath } from "@/lib/links";
import { DateTime } from "luxon";
import type { BoardEvent, BoardTier, HorizonMeta } from "./board-types";

export const DEFAULT_FEED_ID = FEED_ID;

export type RangeKey = "today" | "tomorrow" | "this-week" | "next-week";

export const RANGE_META: Record<
  RangeKey,
  { heading: string; blurb: string; path: string; nav: string }
> = {
  today: { heading: "Today", blurb: "Today's picks, ranked.", path: "/today", nav: "Today" },
  tomorrow: { heading: "Tomorrow", blurb: "Tomorrow's picks, ranked.", path: "/tomorrow", nav: "Tomorrow" },
  "this-week": { heading: "This Week", blurb: "The next 7 days, ranked.", path: "/", nav: "This Week" },
  "next-week": { heading: "Next Week", blurb: "The following 7 days, ranked.", path: "/next-week", nav: "Next Week" },
};

export interface FeedMeta {
  id: string;
  name: string;
  regionId: string;
  timezone: string;
  minScore: number;
}

export async function getFeedMeta(feedId = DEFAULT_FEED_ID): Promise<FeedMeta | null> {
  try {
    const db = getDb();
    const [feed] = await db.select().from(schema.feeds).where(eq(schema.feeds.id, feedId)).limit(1);
    if (!feed) return null;
    const [region] = await db
      .select()
      .from(schema.regions)
      .where(eq(schema.regions.id, feed.regionId ?? "sf_bay"))
      .limit(1);
    return {
      id: feed.id,
      name: feed.name,
      regionId: feed.regionId ?? "sf_bay",
      timezone: region?.timezone ?? "America/Los_Angeles",
      minScore: Number(feed.minScore ?? "6.0"),
    };
  } catch {
    // DB unset/unreachable/unseeded → surface the setup state, never crash the page.
    return null;
  }
}

export interface RangeView {
  meta: FeedMeta;
  events: DeliveryEvent[];
  tiers: { tier: Tier; events: DeliveryEvent[] }[];
  categories: string[];
}

function windowFor(range: RangeKey, tz: string): UtcWindow {
  const now = new Date();
  switch (range) {
    case "today":
      return dayWindow(now, tz, 0);
    case "tomorrow":
      return dayWindow(now, tz, 1);
    case "this-week":
      return thisWeekWindow(now, tz);
    case "next-week":
      return nextWeekWindow(now, tz);
  }
}

export async function getRangeView(opts: {
  range: RangeKey;
  feedId?: string;
  categoryTag?: string;
  tier?: Tier;
  all?: boolean;
}): Promise<RangeView | null> {
  const meta = await getFeedMeta(opts.feedId ?? DEFAULT_FEED_ID);
  if (!meta) return null;

  const window = windowFor(opts.range, meta.timezone);

  // The browse views gate on RELEVANCE, not score: TLDR = every industry-relevant
  // event (ranked, low ones de-emphasized in the UI); All Events = literally
  // everything, including non-relevant noise (bar crawls, film nights, etc.).
  const full = await queryDeliveryEvents({
    feedId: meta.id,
    regionId: meta.regionId,
    minScore: 0,
    relevantOnly: !opts.all,
    window,
  });

  const categories = [...new Set(full.map((e) => e.categoryTag).filter(Boolean))] as string[];

  let events = full;
  if (opts.categoryTag) events = events.filter((e) => e.categoryTag === opts.categoryTag);
  if (opts.tier) events = events.filter((e) => e.tier === opts.tier);

  // Rank within each tier by score (highest first), then by start time.
  const byTier = new Map<Tier, DeliveryEvent[]>();
  for (const e of events) {
    const arr = byTier.get(e.tier) ?? [];
    arr.push(e);
    byTier.set(e.tier, arr);
  }
  const tiers = [...byTier.entries()]
    .map(([tier, evs]) => ({
      tier,
      events: evs.sort(
        (a, b) => b.score - a.score || a.startsAt.getTime() - b.startsAt.getTime(),
      ),
    }))
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);

  return { meta, events, tiers, categories };
}

export function telegramFollowUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_TELEGRAM_URL?.trim();
  if (explicit) return explicit;
  const ch = process.env.TELEGRAM_CHANNEL_ID?.trim();
  if (ch && ch.startsWith("@")) return `https://t.me/${ch.slice(1)}`;
  return null;
}

// ---- EventsBoard mapping (signal-board UI) ----------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  ai: "AI",
  longevity: "Longevity",
  fintech_blockchain: "Fintech/Crypto",
  founder_investor: "Founder/Investor",
  hackathon: "Hackathon",
};

const TIER_TO_BOARD: Record<Tier, BoardTier> = {
  dont_miss: "must_attend",
  strong: "strong_pick",
  radar: "worth_a_look",
};

function sourceFromUrl(url: string | null): string {
  if (!url) return "source";
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h.includes("lu.ma") || h.includes("luma")) return "Luma";
    if (h.includes("eventbrite")) return "Eventbrite";
    if (h.includes("partiful")) return "Partiful";
    if (h.includes("supermomos")) return "Supermomos";
    if (h.includes("cerebralvalley")) return "Cerebral Valley";
    if (h.includes("meetup")) return "Meetup";
    const base = h.split(".")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return "source";
  }
}

function toBoardEvent(e: DeliveryEvent, feedId: string): BoardEvent {
  const key = e.categoryTag ?? "other";
  return {
    id: e.id,
    title: e.title,
    category: CATEGORY_LABELS[key] ?? (e.categoryTag ?? "Event"),
    categoryKey: key,
    score: e.score,
    tier: TIER_TO_BOARD[e.tier] ?? "worth_a_look",
    relevant: e.relevant,
    startsAt: e.startsAt.toISOString(),
    venue: e.venueName,
    city: e.city,
    guestCount: e.guestCount,
    notables: e.notable.map((n) => (n.company ? `${n.name} · ${n.company}` : n.name)),
    tldr: e.tldr,
    source: sourceFromUrl(e.url),
    clickUrl: clickPath(e.id, feedId, "web"),
  };
}

function buildHorizons(tz: string): HorizonMeta[] {
  const now = DateTime.now().setZone(tz);
  const tomo = now.plus({ days: 1 });
  const wkEnd = now.endOf("week"); // Sunday (weeks start Monday)
  const nwStart = now.plus({ weeks: 1 }).startOf("week"); // next Monday
  const nwEnd = now.plus({ weeks: 1 }).endOf("week"); // next Sunday

  const dayMon = (d: DateTime) => d.toFormat("ccc' / 'LLL");
  const rangeLabel = (a: DateTime, b: DateTime) =>
    a.month === b.month ? a.toFormat("LLL") : `${a.toFormat("LLL")} / ${b.toFormat("LLL")}`;
  const longRange = (a: DateTime, b: DateTime) =>
    a.month === b.month
      ? `${a.toFormat("LLLL d")}–${b.toFormat("d")}`
      : `${a.toFormat("LLLL d")}–${b.toFormat("LLLL d")}`;

  return [
    {
      key: "today",
      label: "Today",
      path: "/today",
      date: String(now.day),
      dateLabel: dayMon(now),
      meta: "Happening today",
      boardLabel: "Today’s signal board",
      longDate: now.toFormat("cccc, LLLL d"),
    },
    {
      key: "tomorrow",
      label: "Tomorrow",
      path: "/tomorrow",
      date: String(tomo.day),
      dateLabel: dayMon(tomo),
      meta: "The day ahead",
      boardLabel: "Tomorrow’s signal board",
      longDate: tomo.toFormat("cccc, LLLL d"),
    },
    {
      key: "this-week",
      label: "This Week",
      path: "/",
      date: `${now.day}–${wkEnd.day}`,
      dateLabel: rangeLabel(now, wkEnd),
      meta: "Through Sunday",
      boardLabel: "This week’s signal board",
      longDate: longRange(now, wkEnd),
    },
    {
      key: "next-week",
      label: "Next Week",
      path: "/next-week",
      date: `${nwStart.day}–${nwEnd.day}`,
      dateLabel: rangeLabel(nwStart, nwEnd),
      meta: "Mon–Sun",
      boardLabel: "Next week’s signal board",
      longDate: longRange(nwStart, nwEnd),
    },
  ];
}

export interface BoardView {
  horizonKey: RangeKey;
  horizons: HorizonMeta[];
  events: BoardEvent[];
  telegramUrl: string | null;
}

/** Everything the EventsBoard needs for one horizon: all scored events for the
 *  window (relevant + not; the board toggles TLDR/All client-side). */
export async function getBoardView(range: RangeKey): Promise<BoardView | null> {
  const meta = await getFeedMeta();
  if (!meta) return null;
  const view = await getRangeView({ range, all: true });
  if (!view) return null;
  return {
    horizonKey: range,
    horizons: buildHorizons(meta.timezone),
    events: view.events.map((e) => toBoardEvent(e, meta.id)),
    telegramUrl: telegramFollowUrl(),
  };
}
