// Web read layer (PRD §13). Reads the same store; no schema change. Returns the
// delivered shortlist for "this week" / "next week", tier-grouped, filterable by
// niche (scores.category_tag) and tier.
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { weeklyWindow, type UtcWindow } from "@/lib/time";
import { DateTime } from "luxon";
import { queryDeliveryEvents, type DeliveryEvent } from "@/digest/query";
import type { Tier } from "@/types";
import { TIER_ORDER } from "@/scoring/tiers";
import { FEED_ID } from "@/seed/data";

export const DEFAULT_FEED_ID = FEED_ID;

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

export interface WeekView {
  meta: FeedMeta;
  events: DeliveryEvent[];
  tiers: { tier: Tier; events: DeliveryEvent[] }[];
  categories: string[];
}

export async function getWeekView(opts: {
  feedId?: string;
  which: "this" | "next";
  categoryTag?: string;
  tier?: Tier;
}): Promise<WeekView | null> {
  const meta = await getFeedMeta(opts.feedId ?? DEFAULT_FEED_ID);
  if (!meta) return null;

  const window: UtcWindow =
    opts.which === "this"
      ? weeklyWindow(new Date(), meta.timezone)
      : nextWeekWindow(meta.timezone);

  // Query the FULL delivered set (no category filter) so the niche chips always
  // reflect every niche available this week, then filter in-memory.
  const full = await queryDeliveryEvents({
    feedId: meta.id,
    regionId: meta.regionId,
    minScore: meta.minScore,
    window,
  });

  const categories = [...new Set(full.map((e) => e.categoryTag).filter(Boolean))] as string[];

  let events = full;
  if (opts.categoryTag) events = events.filter((e) => e.categoryTag === opts.categoryTag);
  if (opts.tier) events = events.filter((e) => e.tier === opts.tier);

  const byTier = new Map<Tier, DeliveryEvent[]>();
  for (const e of events) {
    const arr = byTier.get(e.tier) ?? [];
    arr.push(e);
    byTier.set(e.tier, arr);
  }
  const tiers = [...byTier.entries()]
    .map(([tier, evs]) => ({
      tier,
      events: evs.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    }))
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);

  return { meta, events, tiers, categories };
}

function nextWeekWindow(tz: string): UtcWindow {
  // +7 .. +13 local days — contiguous with, and non-overlapping, "this week".
  const local = DateTime.now().setZone(tz);
  return {
    start: local.plus({ days: 7 }).startOf("day").toUTC().toJSDate(),
    end: local.plus({ days: 13 }).endOf("day").toUTC().toJSDate(),
  };
}

export function telegramFollowUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_TELEGRAM_URL?.trim();
  if (explicit) return explicit;
  const ch = process.env.TELEGRAM_CHANNEL_ID?.trim();
  if (ch && ch.startsWith("@")) return `https://t.me/${ch.slice(1)}`;
  return null;
}
