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

  // "All Events" mode drops the quality gate (min_score 0); default TLDR mode
  // keeps the feed's min_score so only worth-your-time events show.
  const minScore = opts.all ? 0 : meta.minScore;

  // Query the FULL delivered set (no category filter) so the niche chips always
  // reflect every niche available in this range, then filter in-memory.
  const full = await queryDeliveryEvents({
    feedId: meta.id,
    regionId: meta.regionId,
    minScore,
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
