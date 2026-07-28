// Digest poster (PRD §12.3). Runs every ~15 min: for each feed, check per-feed
// post schedules (timezone-aware), build the ranked digest, post to the public
// Telegram channel, and log to digest_posts. `force` bypasses the schedule for
// shadow-mode QA (Milestone 3).
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { FeedRow } from "@/db/schema";
import type { DigestKind, PostSchedule } from "@/types";
import { dayWindow, weeklyWindow, localHourAndDow, type UtcWindow } from "@/lib/time";
import { queryDeliveryEvents } from "./query";
import { renderDigestMessage } from "./render";
import { sendMessage, telegramConfigured } from "@/telegram/api";
import { logger } from "@/lib/logger";

const log = logger("poster");

export interface PosterResult {
  feedId: string;
  kind: DigestKind;
  posted: boolean;
  events: number;
  messages: number;
  status: "sent" | "failed" | "partial" | "skipped";
  reason?: string;
}

export async function runDigestPoster(opts?: {
  feedId?: string;
  force?: DigestKind;
  channelOverride?: string;
}): Promise<PosterResult[]> {
  const db = getDb();
  if (!telegramConfigured()) {
    return [{ feedId: "*", kind: "daily", posted: false, events: 0, messages: 0, status: "skipped", reason: "telegram not configured" }];
  }

  const regions = await db.select().from(schema.regions);
  const tzById = new Map(regions.map((r) => [r.id, r.timezone]));

  const feeds = await db
    .select()
    .from(schema.feeds)
    .where(eq(schema.feeds.enabled, true));
  const targets = opts?.feedId ? feeds.filter((f) => f.id === opts.feedId) : feeds;

  const now = new Date();
  const out: PosterResult[] = [];

  for (const feed of targets) {
    const tz = tzById.get(feed.regionId ?? "") ?? "America/Los_Angeles";
    const channelId = opts?.channelOverride || feed.telegramChannelId || process.env.TELEGRAM_CHANNEL_ID;
    if (!channelId) {
      out.push({ feedId: feed.id, kind: "daily", posted: false, events: 0, messages: 0, status: "skipped", reason: "no channel id" });
      continue;
    }

    const forced = !!opts?.force;
    const kinds: DigestKind[] = forced ? [opts!.force!] : await dueKinds(feed, tz, now);

    for (const kind of kinds) {
      out.push(await postOne(feed, kind, tz, channelId, now, forced));
    }
  }
  return out;
}

// Post at the scheduled time, but keep trying for a few hours if that exact tick
// never arrives. Cron delivery is not guaranteed to the minute — on 2026-07-27 no
// digest tick landed inside the scheduled hour at all and the day was silently
// skipped. Treating the schedule as "due from T onwards" instead of "due only at
// T" means a missed tick delays the post rather than losing it. `postedSince` is
// what prevents a repeat, so a wider window cannot cause a double post.
const CATCH_UP_HOURS = Number(process.env.DIGEST_CATCH_UP_HOURS ?? 4);

async function dueKinds(feed: FeedRow, tz: string, now: Date): Promise<DigestKind[]> {
  const sched = (feed.postSchedule ?? {}) as PostSchedule;
  const { hour, minute, dow } = localHourAndDow(now, tz);
  const due: DigestKind[] = [];
  const nowMinutes = hour * 60 + minute;

  // The daily gather finishes shortly before this, so hold the post until the
  // chain has had time to land (see cron/window.ts for the stage timeline).
  const DAILY_POST_AFTER_MINUTE = Number(process.env.DAILY_POST_AFTER_MINUTE ?? 28);

  if (sched.daily_hour != null) {
    const from = sched.daily_hour * 60 + DAILY_POST_AFTER_MINUTE;
    // Clamp to the end of the local day: past midnight the "already posted today"
    // check refers to a different day, so catching up there would double-post.
    const until = Math.min(from + CATCH_UP_HOURS * 60, 24 * 60 - 1);
    if (nowMinutes >= from && nowMinutes <= until) {
      const start = dayWindow(now, tz, 0).start;
      if (!(await postedSince(feed.id, "daily", start))) due.push("daily");
    }
  }
  if (sched.weekly_dow != null && sched.weekly_hour != null && dow === sched.weekly_dow) {
    const from = sched.weekly_hour * 60;
    const until = Math.min(from + CATCH_UP_HOURS * 60, 24 * 60 - 1);
    if (nowMinutes >= from && nowMinutes <= until) {
      const sixDaysAgo = new Date(now.getTime() - 6 * 86400000);
      if (!(await postedSince(feed.id, "weekly", sixDaysAgo))) due.push("weekly");
    }
  }
  return due;
}

async function postedSince(feedId: string, kind: DigestKind, cutoff: Date): Promise<boolean> {
  const db = getDb();
  // Count anything that emitted ≥1 message ('sent' or 'partial') as "done for this
  // period", so a partial send is never re-sent from scratch (no duplicate posts).
  // A total failure ('failed', 0 messages sent) is NOT counted → safe to retry.
  //
  // A FORCED post ('<kind>_manual') counts too. It is still a real digest landing
  // in the real chat, so letting the scheduler post again on top of it duplicates
  // the message to readers — which is exactly what happened on 2026-07-27, when a
  // manual send at 19:34 was followed by the scheduled one at 20:00. Keeping the
  // audit kinds distinct but treating both as "already posted" errs toward the
  // recoverable failure: a skipped post can be re-sent, a double post can't be
  // unsent.
  const [row] = await db
    .select({ id: schema.digestPosts.id })
    .from(schema.digestPosts)
    .where(
      and(
        eq(schema.digestPosts.feedId, feedId),
        inArray(schema.digestPosts.kind, [kind, `${kind}_manual`]),
        inArray(schema.digestPosts.status, ["sent", "partial"]),
        gte(schema.digestPosts.postedAt, cutoff),
      ),
    )
    .orderBy(desc(schema.digestPosts.postedAt))
    .limit(1);
  return !!row;
}

async function postOne(
  feed: FeedRow,
  kind: DigestKind,
  tz: string,
  channelId: string,
  now: Date,
  forced = false,
): Promise<PosterResult> {
  const db = getDb();
  // Daily digest posts in the evening and covers TOMORROW only (dayWindow +1).
  const window: UtcWindow =
    kind === "daily" ? dayWindow(now, tz, 1) : weeklyWindow(now, tz);

  const events = await queryDeliveryEvents({
    feedId: feed.id,
    regionId: feed.regionId ?? "sf_bay",
    minScore: Number(feed.minScore ?? "6.0"),
    relevantOnly: true,
    window,
  });

  // No empty daily posts (§12.3); weekly emits a "quiet week" note.
  if (events.length === 0 && kind === "daily") {
    return { feedId: feed.id, kind, posted: false, events: 0, messages: 0, status: "skipped", reason: "no events" };
  }

  // ONE compact message per digest — no chunk splitting, no inline buttons.
  const html = renderDigestMessage(feed, events, kind, tz);
  const messageIds: number[] = [];
  let migrated: string | undefined;
  let status: "sent" | "failed" | "partial" = "sent";

  try {
    const res = await sendMessage(channelId, html);
    messageIds.push(res.messageId);
    if (res.migratedChatId) migrated = String(res.migratedChatId);
  } catch (e) {
    log.error(`send failed for feed ${feed.id} (${kind})`, e);
    status = "failed";
  }

  await db.insert(schema.digestPosts).values({
    feedId: feed.id,
    // Forced/QA posts get a distinct kind so they don't suppress the real
    // scheduled digest's due-check (which queries kind 'daily'/'weekly').
    kind: forced ? `${kind}_manual` : kind,
    windowStart: window.start,
    windowEnd: window.end,
    eventIds: events.map((e) => e.id),
    tgMessageIds: messageIds,
    status,
    postedAt: new Date(),
  });

  if (migrated) {
    await db
      .update(schema.feeds)
      .set({ telegramChannelId: migrated })
      .where(eq(schema.feeds.id, feed.id));
    log.info(`feed ${feed.id} channel updated → ${migrated}`);
  }

  log.info(`poster[${feed.id}/${kind}]: ${status}, ${messageIds.length} msgs, ${events.length} events`);
  return {
    feedId: feed.id,
    kind,
    posted: messageIds.length > 0,
    events: events.length,
    messages: messageIds.length,
    status,
  };
}
