// On-demand bot (PRD §12.2). Webhook-based (no polling). Answers /today,
// /tomorrow, /week, /nextweek in the same ranked, tier-grouped format. Public
// members can query; TELEGRAM_ALLOWED_CHAT_IDS gates admin/test commands.
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { FeedRow } from "@/db/schema";
import { thisWeekWindow, nextWeekWindow, type UtcWindow } from "@/lib/time";
import { DateTime } from "luxon";
import { queryDeliveryEvents } from "@/digest/query";
import { renderEventsMessage, DIGEST_LEGEND } from "@/digest/render";
import { sendMessage, htmlEscape } from "./api";
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
  "Commands (slash optional — just type the letter):\n" +
  "<b>t</b> or /today — today's picks\n" +
  "<b>tmr</b> or /tomorrow — tomorrow's picks\n" +
  "<b>w</b> or /week — this week (through Sunday)\n" +
  "<b>nw</b> or /nextweek — next week (Mon–Sun)\n" +
  "<b>thu</b>, <b>fri</b>, <b>sat</b>… — any weekday, next time it comes round\n\n" +
  "Curated, scored, and summarized. Skip the firehose.";

/** Bare-word shortcuts, so members can type "t" instead of "/today".
 *  NOTE: for these to reach the bot in a GROUP, group privacy must be disabled
 *  for the bot in @BotFather (/setprivacy → Disable); otherwise Telegram only
 *  delivers messages that start with "/" or @mention the bot. */
const SHORTCUTS: Record<string, string> = {
  t: "/today",
  today: "/today",
  tmr: "/tomorrow",
  tm: "/tomorrow",
  tomorrow: "/tomorrow",
  w: "/week",
  week: "/week",
  nw: "/nextweek",
  nextweek: "/nextweek",
};

/** Weekday names → Luxon weekday (1 = Mon … 7 = Sun). "thu"/"thurs"/"thursday"
 *  all work; a bare day name resolves to its NEXT occurrence, today included, so
 *  planning a week out is one word. */
const WEEKDAYS: Record<string, number> = {
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
  sun: 7, sunday: 7,
};

export async function handleUpdate(update: TgUpdate): Promise<void> {
  const msg = update.message ?? update.channel_post;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  const fromId = (update.message?.from?.id ?? chatId) as number;
  const text = msg.text.trim();
  // Normalize "/today@BotName" → "/today".
  const first = text.split(/\s+/)[0].replace(/@.*$/, "").toLowerCase();
  // A bare word is only a shortcut when it's the WHOLE message ("t", "tmr"), so
  // normal chat that happens to start with "w" doesn't trigger a digest.
  const isSingleWord = !/\s/.test(text);
  const cmd =
    !first.startsWith("/") && isSingleWord && SHORTCUTS[first] ? SHORTCUTS[first] : first;

  const db = getDb();
  const [feed] = await db
    .select()
    .from(schema.feeds)
    .where(eq(schema.feeds.enabled, true))
    .limit(1);
  if (!feed) return;
  const tz = await regionTz(feed.regionId ?? "sf_bay");

  // A weekday name ("thursday", "thurs", "/fri") → that day's events.
  const dayWord = (cmd.startsWith("/") ? cmd.slice(1) : cmd).toLowerCase();
  if (isSingleWord && WEEKDAYS[dayWord]) {
    const today = DateTime.now().setZone(tz).startOf("day");
    // Next occurrence, counting today — "thursday" ON Thursday means today.
    const delta = (WEEKDAYS[dayWord] - today.weekday + 7) % 7;
    const target = today.plus({ days: delta });
    const when = delta === 0 ? "Today" : delta === 1 ? "Tomorrow" : target.toFormat("cccc");
    await respond(
      chatId,
      feed,
      tz,
      { start: target.toUTC().toJSDate(), end: target.endOf("day").toUTC().toJSDate() },
      `🗓️ <b>${when} — ${target.toFormat("ccc LLL d")}</b>`,
    );
    return;
  }

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
      await respond(chatId, feed, tz, thisWeekWindow(new Date(), tz), "🗓️ <b>This Week</b>");
      return;
    case "/nextweek":
      await respond(chatId, feed, tz, nextWeekWindow(new Date(), tz), "🗓️ <b>Next Week</b>");
      return;
    // Bind the scheduled digests to THIS chat (admin only). Lets the bot be
    // moved to a new group without redeploying: it captures the group's id and
    // every future scheduled digest posts here instead of the old chat.
    case "/usehere":
    case "/posthere": {
      const allow = allowedChatIds();
      if (!allow.includes(fromId)) {
        await sendMessage(chatId, "Not authorized.");
        return;
      }
      const previous = feed.telegramChannelId ?? process.env.TELEGRAM_CHANNEL_ID ?? "(none)";
      await db
        .update(schema.feeds)
        .set({ telegramChannelId: String(chatId) })
        .where(eq(schema.feeds.id, feed.id));
      log.info(`feed ${feed.id} digest target → ${chatId} (was ${previous})`);
      await sendMessage(
        chatId,
        `✅ Daily + weekly digests will post <b>here</b> from now on.\n\n` +
          `Chat ID: <code>${chatId}</code>\nPrevious: <code>${htmlEscape(String(previous))}</code>\n\n` +
          `Daily digest: 5:00 PM PT with tomorrow's events.`,
      );
      return;
    }
    // Admin/test commands (gated).
    case "/post_daily":
    case "/post_weekly": {
      // Fail closed: with no allowlist configured, NO ONE may run admin commands.
      const allow = allowedChatIds();
      if (!allow.includes(fromId)) {
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
  const all = await queryDeliveryEvents({
    feedId: feed.id,
    regionId: feed.regionId ?? "sf_bay",
    minScore: 0,
    relevantOnly: true,
    window,
  });
  // Curated (TLDR) floor: events at/below 4.0 live only in the web "All" view.
  const events = all.filter((e) => e.score > 4.0);
  if (events.length === 0) {
    await sendMessage(chatId, `${headerText}\n\nNothing clears the bar right now — check back soon.`);
    return;
  }
  const header = `${headerText}\n📊 ${events.length} curated events | ${DIGEST_LEGEND}`;
  await sendMessage(chatId, renderEventsMessage(header, events, tz));
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
