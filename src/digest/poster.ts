// Digest poster (PRD §12.3). Runs every ~15 min: for each feed, check per-feed
// post schedules (timezone-aware), build the ranked digest, post to the public
// Telegram channel, and log to digest_posts. `force` bypasses the schedule for
// shadow-mode QA (Milestone 3).
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { FeedRow } from "@/db/schema";
import type { DigestKind, PostSchedule } from "@/types";
import { dailyWindow, weeklyWindow, localHourAndDow, type UtcWindow } from "@/lib/time";
import { queryDeliveryEvents } from "./query";
import { renderDigestMessages } from "./render";
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

async function dueKinds(feed: FeedRow, tz: string, now: Date): Promise<DigestKind[]> {
  const sched = (feed.postSchedule ?? {}) as PostSchedule;
  const { hour, dow } = localHourAndDow(now, tz);
  const due: DigestKind[] = [];

  if (sched.daily_hour != null && hour === sched.daily_hour) {
    const start = dailyWindow(now, tz).start;
    if (!(await postedSince(feed.id, "daily", start))) due.push("daily");
  }
  if (
    sched.weekly_dow != null &&
    sched.weekly_hour != null &&
    dow === sched.weekly_dow &&
    hour === sched.weekly_hour
  ) {
    const sixDaysAgo = new Date(now.getTime() - 6 * 86400000);
    if (!(await postedSince(feed.id, "weekly", sixDaysAgo))) due.push("weekly");
  }
  return due;
}

async function postedSince(feedId: string, kind: DigestKind, cutoff: Date): Promise<boolean> {
  const db = getDb();
  // Count anything that emitted ≥1 message ('sent' or 'partial') as "done for this
  // period", so a partial send is never re-sent from scratch (no duplicate posts).
  // A total failure ('failed', 0 messages sent) is NOT counted → safe to retry.
  const [row] = await db
    .select({ id: schema.digestPosts.id })
    .from(schema.digestPosts)
    .where(
      and(
        eq(schema.digestPosts.feedId, feedId),
        eq(schema.digestPosts.kind, kind),
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
  const window: UtcWindow = kind === "daily" ? dailyWindow(now, tz) : weeklyWindow(now, tz);

  const events = await queryDeliveryEvents({
    feedId: feed.id,
    regionId: feed.regionId ?? "sf_bay",
    minScore: Number(feed.minScore ?? "6.0"),
    window,
  });

  // No empty daily posts (§12.3); weekly emits a "quiet week" note.
  if (events.length === 0 && kind === "daily") {
    return { feedId: feed.id, kind, posted: false, events: 0, messages: 0, status: "skipped", reason: "no events" };
  }

  const chunks = renderDigestMessages(feed, events, kind, tz);
  const messageIds: number[] = [];
  let migrated: string | undefined;
  let failedMidway = false;

  for (const chunk of chunks) {
    try {
      const res = await sendMessage(channelId, chunk.html, chunk.buttons);
      messageIds.push(res.messageId);
      if (res.migratedChatId) migrated = String(res.migratedChatId);
    } catch (e) {
      log.error(`send failed for feed ${feed.id} (${kind})`, e);
      failedMidway = true;
      break;
    }
  }

  // 'sent' = all chunks delivered; 'partial' = some delivered then errored (must
  // NOT be re-sent → dedup counts it as done); 'failed' = nothing delivered (safe
  // to retry next run).
  const status: "sent" | "failed" | "partial" = failedMidway
    ? messageIds.length > 0
      ? "partial"
      : "failed"
    : "sent";

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
