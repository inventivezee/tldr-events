// Telegram digest rendering (PRD §12.1). ONE compact message per digest — linked
// event titles (direct to source), a single meta line, and speaker names. No
// per-event summary, no inline buttons. Fits within Telegram's 4096-char cap
// (truncates with a "more on the web" footer if needed).
import type { FeedRow } from "@/db/schema";
import type { DigestKind, Tier } from "@/types";
import type { DeliveryEvent } from "./query";
import { DateTime } from "luxon";
import { htmlEscape } from "@/telegram/api";
import { siteUrl } from "@/lib/links";

const MAX_CHARS = 3950; // safety margin under Telegram's 4096

/** Category legend shown in every digest header (scheduled + on-demand bot). */
export const DIGEST_LEGEND = "🤖 AI · 🧬 Longevity · 🔒 Web3 · 🌟 Founders · 🛠️ Hackathon";

const CAT_EMOJI: Record<string, string> = {
  ai: "🤖",
  longevity: "🧬",
  fintech_blockchain: "🔒",
  founder_investor: "🌟",
  hackathon: "🛠️",
};

const SECTION: Record<Tier, string> = {
  dont_miss: "🔥 <b>Must Attend (8-10)</b>",
  strong: "⚡ <b>Strong Picks (6-7)</b>",
  radar: "👀 <b>Worth a Look</b>",
};
const TIER_SEQUENCE: Tier[] = ["dont_miss", "strong", "radar"];

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function urlAttr(u: string): string {
  // Escape for an HTML href attribute. Angle brackets MUST be encoded too — a raw
  // < or > anywhere in the URL breaks Telegram's HTML parser and fails the whole
  // sendMessage, not just this one link.
  return u
    .replace(/&/g, "&amp;")
    .replace(/"/g, "%22")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E");
}

/** "Tue, Jul 21 5 PM" / "Fri, Jul 24 10:30 AM" in the feed/region tz. */
function fmtWhen(utc: Date, tz: string): string {
  const d = DateTime.fromJSDate(utc, { zone: "utc" }).setZone(tz);
  const date = d.toFormat("ccc, LLL d");
  const time = d.minute === 0 ? d.toFormat("h a") : d.toFormat("h:mm a");
  return `${date} ${time}`;
}

function eventBlock(e: DeliveryEvent, tz: string): string {
  const title = htmlEscape(truncate(e.title, 90));
  const link = e.url ? `<a href="${urlAttr(e.url)}">${title}</a>` : title;
  const emoji = CAT_EMOJI[e.categoryTag ?? ""] ?? "";
  const parts = [fmtWhen(e.startsAt, tz)];
  // Only show attendance when we actually have it — a null/0 count is "unknown",
  // not "zero people", and a fabricated "👥 0" reads as a dead event.
  if (e.guestCount != null && e.guestCount > 0) parts.push(`👥 ${e.guestCount}`);
  if (emoji) parts.push(emoji);
  let block = `• ${link}\n${parts.join(" · ")}`;
  if (e.speakerNames.length) {
    block += `\n🎤 ${htmlEscape(e.speakerNames.slice(0, 3).join(", "))}`;
  }
  return block;
}

/** Compact one-message renderer shared by scheduled digests + the on-demand bot. */
export function renderEventsMessage(header: string, events: DeliveryEvent[], tz: string): string {
  const out: string[] = [header];
  let len = header.length;
  let shown = 0;

  for (const tier of TIER_SEQUENCE) {
    const evs = events
      .filter((e) => e.tier === tier)
      .sort((a, b) => b.score - a.score || a.startsAt.getTime() - b.startsAt.getTime());
    if (evs.length === 0) continue;

    let sectionOpen = false;
    for (const e of evs) {
      const block = eventBlock(e, tz);
      const add = (sectionOpen ? 0 : SECTION[tier].length + 2) + block.length + 1;
      if (len + add > MAX_CHARS) {
        const remaining = events.length - shown;
        out.push(`\n… +${remaining} more at ${siteUrl()}`);
        return out.join("\n");
      }
      if (!sectionOpen) {
        out.push(`\n${SECTION[tier]}`);
        len += SECTION[tier].length + 2;
        sectionOpen = true;
      }
      out.push(block);
      len += block.length + 1;
      shown++;
    }
  }
  return out.join("\n");
}

function digestHeader(feed: FeedRow, events: DeliveryEvent[], kind: DigestKind, tz: string): string {
  const legend = DIGEST_LEGEND;
  const count = events.length;
  if (kind === "daily") {
    return `☀️ <b>Bay Area Events — Today &amp; Tomorrow</b>\n📊 ${count} curated events | ${legend}`;
  }
  let range = "";
  if (events.length) {
    const first = DateTime.fromJSDate(events[0].startsAt, { zone: "utc" }).setZone(tz);
    const last = DateTime.fromJSDate(events[events.length - 1].startsAt, { zone: "utc" }).setZone(tz);
    range =
      first.month === last.month
        ? ` — Week of ${first.toFormat("LLL d")}-${last.toFormat("d")}`
        : ` — Week of ${first.toFormat("LLL d")}-${last.toFormat("LLL d")}`;
  }
  return `📅 <b>Bay Area Events${range}</b>\n📊 ${count} curated events | ${legend}`;
}

/** One message for a scheduled digest. Empty daily → "" (poster skips); empty weekly → quiet note. */
export function renderDigestMessage(
  feed: FeedRow,
  events: DeliveryEvent[],
  kind: DigestKind,
  tz: string,
): string {
  if (events.length === 0) {
    return kind === "weekly" ? quietWeekMessage() : "";
  }
  // Sort by start time for the header range calc; sections re-sort by score.
  const byDate = [...events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return renderEventsMessage(digestHeader(feed, byDate, kind, tz), events, tz);
}

export function quietWeekMessage(): string {
  return (
    `📅 <b>Bay Area Events — The Week Ahead</b>\n\n` +
    `A quiet week — nothing cleared the bar this time. We only send events genuinely worth ` +
    `your evening, so no filler. Back with the next standout.`
  );
}
