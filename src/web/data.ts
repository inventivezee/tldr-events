// Web read layer (PRD §13). Reads the same store; no schema change. Returns the
// delivered shortlist for "this week" / "next week", tier-grouped, filterable by
// niche (scores.category_tag) and tier.
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import {
  dayWindow,
  thisWeekWindow,
  nextWeekWindow,
  windowForLocalDate,
  type UtcWindow,
} from "@/lib/time";
import { queryDeliveryEvents, type DeliveryEvent } from "@/digest/query";
import type { Tier } from "@/types";
import { TIER_ORDER } from "@/scoring/tiers";
import { FEED_ID } from "@/seed/data";
import { clickPath } from "@/lib/links";
import { DateTime } from "luxon";
import type { BoardEvent, BoardTier, CalendarDay, HorizonMeta } from "./board-types";

export const DEFAULT_FEED_ID = FEED_ID;

export type RangeKey = "today" | "tomorrow" | "this-week" | "next-week";

/** Either a named horizon or one specific local calendar day. */
export type BoardRange = RangeKey | { day: string };

/** How far ahead the browse calendar reaches. */
export const CALENDAR_DAYS = 28;

/** Events at or below this score are noise, excluded from the curated view — the
 *  same floor the board applies in TLDR mode, so calendar counts match the page. */
const CURATED_MIN_SCORE = 4.0;

/** Mirrors VISIBLE_MIN_SCORE in EventsBoard: the score an event needs to appear
 *  in the main list rather than behind "show lower-ranked". */
export const BOARD_VISIBLE_MIN_SCORE = 6.5;

export const RANGE_META: Record<
  RangeKey,
  { heading: string; blurb: string; path: string; nav: string }
> = {
  today: { heading: "Today", blurb: "Today's picks, ranked.", path: "/today", nav: "Today" },
  tomorrow: { heading: "Tomorrow", blurb: "Tomorrow's picks, ranked.", path: "/tomorrow", nav: "Tomorrow" },
  "this-week": { heading: "This Week", blurb: "Through Sunday, ranked.", path: "/", nav: "This Week" },
  "next-week": { heading: "Next Week", blurb: "Next Mon–Sun, ranked.", path: "/next-week", nav: "Next Week" },
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

function windowFor(range: BoardRange, tz: string): UtcWindow {
  const now = new Date();
  if (typeof range === "object") return windowForLocalDate(range.day, tz);
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
  range: BoardRange;
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

function toBoardEvent(e: DeliveryEvent, feedId: string): BoardEvent {
  const key = e.categoryTag ?? "other";
  // One entry per distinct destination; the primary is first.
  const links = e.links.map((l) => ({
    label: l.label,
    clickUrl: clickPath(e.id, feedId, "web", l.eventId),
  }));
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
    source: links[0]?.label ?? "source",
    clickUrl: links[0]?.clickUrl ?? clickPath(e.id, feedId, "web"),
    sourceUrl: e.links[0]?.url ?? e.url,
    endsAt: e.endsAt ? e.endsAt.toISOString() : null,
    links,
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
  horizonKey: RangeKey | "day";
  /** Set when the week ran dry and next week was pulled in to fill it — a
   *  sentence explaining the extra dates, so the extra events never look like a
   *  bug in the date filter. */
  extendedNote: string | null;
  /** Local ISO date when viewing one specific day, else null. */
  activeDay: string | null;
  horizons: HorizonMeta[];
  calendar: CalendarDay[];
  events: BoardEvent[];
  telegramUrl: string | null;
}

/** Per-day curated counts for the browse calendar — one aggregate query rather
 *  than shipping weeks of events to the client just to count them. Counts match
 *  what the default (TLDR) board shows: industry-relevant and above the floor. */
async function getCalendarDays(
  meta: FeedMeta,
  days = CALENDAR_DAYS,
): Promise<CalendarDay[]> {
  const tz = meta.timezone;
  const today = DateTime.now().setZone(tz).startOf("day");
  const window = { start: today.toUTC().toJSDate(), end: today.plus({ days }).endOf("day").toUTC().toJSDate() };

  const rows = await getDb()
    .select({
      day: sql<string>`to_char(${schema.events.startsAt} at time zone ${sql.raw(`'${tz}'`)}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
      topScore: sql<number>`max(${schema.scores.score})::float`,
    })
    .from(schema.events)
    .innerJoin(
      schema.scores,
      and(eq(schema.scores.eventId, schema.events.id), eq(schema.scores.feedId, meta.id)),
    )
    .where(
      and(
        eq(schema.events.regionId, meta.regionId),
        eq(schema.events.isPrimary, true),
        eq(schema.events.status, "active"),
        eq(schema.scores.relevant, true),
        gte(schema.scores.score, String(CURATED_MIN_SCORE)),
        gte(schema.events.startsAt, window.start),
        lte(schema.events.startsAt, window.end),
      ),
    )
    .groupBy(sql`1`);

  const byDay = new Map(rows.map((r) => [r.day, r]));
  const todayISO = today.toFormat("yyyy-MM-dd");
  return Array.from({ length: days }, (_, i) => {
    const d = today.plus({ days: i });
    const iso = d.toFormat("yyyy-MM-dd");
    const hit = byDay.get(iso);
    return {
      date: iso,
      dow: d.toFormat("ccc"),
      dayOfMonth: d.day,
      month: d.toFormat("LLL"),
      count: hit?.count ?? 0,
      topScore: hit?.topScore ?? null,
      isToday: iso === todayISO,
      isPast: false,
    };
  });
}

/** Everything the EventsBoard needs for one horizon (or a single day): all scored
 *  events for the window (relevant + not; the board toggles TLDR/All client-side)
 *  plus the browse calendar. */
export async function getBoardView(range: BoardRange): Promise<BoardView | null> {
  const meta = await getFeedMeta();
  if (!meta) return null;
  const [view, calendar] = await Promise.all([
    getRangeView({ range, all: true }),
    getCalendarDays(meta),
  ]);
  if (!view) return null;
  const isDay = typeof range === "object";

  let events = view.events;
  let extendedNote: string | null = null;

  // "This week" shrinks as the week goes on, and by Sunday it covers a single
  // day — which regularly leaves nothing above the board's floor while the week
  // ahead is full. Rather than show an empty board, roll next week in and say so.
  if (shouldExtendThisWeek(range, events)) {
    const next = await getRangeView({ range: "next-week", all: true });
    if (next && clearsFloor(next.events).length) {
      // The two windows are adjacent, not overlapping (this week ends Sunday,
      // next week starts Monday), so nothing is duplicated by concatenating.
      events = [...events, ...next.events];
      const nw = nextWeekWindow(new Date(), meta.timezone);
      const from = DateTime.fromJSDate(nw.start, { zone: "utc" }).setZone(meta.timezone);
      const to = DateTime.fromJSDate(nw.end, { zone: "utc" }).setZone(meta.timezone);
      const span =
        from.month === to.month
          ? `${from.toFormat("LLL d")}–${to.toFormat("d")}`
          : `${from.toFormat("LLL d")}–${to.toFormat("LLL d")}`;
      extendedNote = `Also showing next week · ${span}`;
    }
  }

  return {
    horizonKey: isDay ? "day" : range,
    extendedNote,
    activeDay: isDay ? range.day : null,
    horizons: buildHorizons(meta.timezone),
    calendar,
    events: events.map((e) => toBoardEvent(e, meta.id)),
    telegramUrl: telegramFollowUrl(),
  };
}

/** Events a visitor sees by default: relevant and above the board's floor. */
export function clearsFloor<T extends { relevant: boolean; score: number }>(events: T[]): T[] {
  return events.filter((e) => e.relevant && e.score >= BOARD_VISIBLE_MIN_SCORE);
}

/**
 * Should the "this week" board borrow next week?
 *
 * Only when nothing at all clears the floor. A thin week is still a week; the
 * case worth fixing is the empty board — most obviously on a Sunday, when the
 * window has narrowed to a single day.
 */
export function shouldExtendThisWeek<T extends { relevant: boolean; score: number }>(
  range: BoardRange,
  events: T[],
): boolean {
  return range === "this-week" && clearsFloor(events).length === 0;
}
