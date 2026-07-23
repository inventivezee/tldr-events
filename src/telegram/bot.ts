// On-demand bot (PRD §12.2). Webhook-based (no polling). Answers /today,
// /tomorrow, /week, /nextweek in the same ranked, tier-grouped format. Public
// members can query; TELEGRAM_ALLOWED_CHAT_IDS gates admin/test commands.
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { FeedRow } from "@/db/schema";
import { weeklyWindow, type UtcWindow } from "@/lib/time";
import { DateTime } from "luxon";
import { queryDeliveryEvents } from "@/digest/query";
import { renderEventList } from "@/digest/render";
import { sendMessage } from "./api";
import { runDigestPoster } from "@/digest/poster";
import { allowedChatIds } from "@/config/env";
import { logger } from "@/lib/logger";

const log = logger("bot");

interface TgUpdate {
  message?: { chat: { id: number; type: string }; text?: string; from?: { id: number } };
  channel_post?: { chat: { id: number }; text?: string };
}

const HELP =
  "👋 <b>TLDR Events</b> — the best Bay Area events for founders &amp; investors.\n\n" +
  "Commands:\n" +
  "/today — today's picks\n" +
  "/tomorrow — tomorrow's picks\n" +
  "/week — the next 7 days\n" +
  "/nextweek — the following 7 days\n\n" +
  "Curated, scored, and summarized. Skip the firehose.";

export async function handleUpdate(update: TgUpdate): Promise<void> {
  const msg = update.message ?? update.channel_post;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  const fromId = (update.message?.from?.id ?? chatId) as number;
  const text = msg.text.trim();
  // Normalize "/today@BotName" → "/today".
  const cmd = text.split(/\s+/)[0].replace(/@.*$/, "").toLowerCase();

  const db = getDb();
  const [feed] = await db
    .select()
    .from(schema.feeds)
    .where(eq(schema.feeds.enabled, true))
    .limit(1);
  if (!feed) return;
  const tz = await regionTz(feed.regionId ?? "sf_bay");

  switch (cmd) {
    case "/start":
    case "/help":
      await sendMessage(chatId, HELP);
      return;
    case "/today":
      await respond(chatId, feed, tz, todayWindow(tz), "☀️ <b>Today</b>");
      return;
    case "/tomorrow":
      await respond(chatId, feed, tz, tomorrowWindow(tz), "🌅 <b>Tomorrow</b>");
      return;
    case "/week":
      await respond(chatId, feed, tz, weeklyWindow(new Date(), tz), "🗓️ <b>The Week Ahead</b>");
      return;
    case "/nextweek":
      await respond(chatId, feed, tz, nextWeekWindow(tz), "🗓️ <b>Next Week</b>");
      return;
    // Admin/test commands (gated).
    case "/post_daily":
    case "/post_weekly": {
      const allow = allowedChatIds();
      if (allow.length && !allow.includes(fromId)) {
        await sendMessage(chatId, "Not authorized.");
        return;
      }
      const kind = cmd === "/post_daily" ? "daily" : "weekly";
      const res = await runDigestPoster({ feedId: feed.id, force: kind, channelOverride: String(chatId) });
      await sendMessage(chatId, `Forced ${kind} digest → ${JSON.stringify(res)}`);
      return;
    }
    default:
      if (cmd.startsWith("/")) await sendMessage(chatId, HELP);
      return;
  }
}

async function respond(
  chatId: number,
  feed: FeedRow,
  tz: string,
  window: UtcWindow,
  headerText: string,
): Promise<void> {
  const events = await queryDeliveryEvents({
    feedId: feed.id,
    regionId: feed.regionId ?? "sf_bay",
    minScore: Number(feed.minScore ?? "6.0"),
    window,
  });
  if (events.length === 0) {
    await sendMessage(chatId, `${headerText}\n\nNothing clears the bar right now — check back soon.`);
    return;
  }
  const chunks = renderEventList(feed, events, headerText, tz);
  for (const chunk of chunks) {
    await sendMessage(chatId, chunk.html, chunk.buttons);
  }
  log.info(`bot replied ${events.length} events to chat ${chatId}`);
}

async function regionTz(regionId: string): Promise<string> {
  const db = getDb();
  const [r] = await db
    .select({ tz: schema.regions.timezone })
    .from(schema.regions)
    .where(eq(schema.regions.id, regionId))
    .limit(1);
  return r?.tz ?? "America/Los_Angeles";
}

function todayWindow(tz: string): UtcWindow {
  const local = DateTime.now().setZone(tz);
  return {
    start: local.startOf("day").toUTC().toJSDate(),
    end: local.endOf("day").toUTC().toJSDate(),
  };
}
function tomorrowWindow(tz: string): UtcWindow {
  const local = DateTime.now().setZone(tz).plus({ days: 1 });
  return {
    start: local.startOf("day").toUTC().toJSDate(),
    end: local.endOf("day").toUTC().toJSDate(),
  };
}
function nextWeekWindow(tz: string): UtcWindow {
  const local = DateTime.now().setZone(tz);
  return {
    start: local.plus({ days: 7 }).startOf("day").toUTC().toJSDate(),
    end: local.plus({ days: 14 }).endOf("day").toUTC().toJSDate(),
  };
}
