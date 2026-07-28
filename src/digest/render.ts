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
export const DIGEST_LEGEND =
  "🤖 AI · 🧬 Longevity · ₿ Web3 · 🧑‍💼 Founders · 🛠️ Hackathon · 🎤 Who's speaking";

// One icon per niche — also used as the bullet leading each event.
// NOTE: these must be standard Unicode. Telegram only permits CUSTOM emoji
// (<tg-emoji emoji-id="…">) from bots that have purchased a username on
// Fragment, so a bespoke icon isn't available to this bot.
const CAT_EMOJI: Record<string, string> = {
  ai: "🤖",
  longevity: "🧬",
  fintech_blockchain: "₿", // U+20BF BITCOIN SIGN — a text glyph, not a color emoji
  founder_investor: "🧑‍💼",
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
  const primary = e.links[0]?.url ?? e.url;
  const link = primary ? `<a href="${urlAttr(primary)}">${title}</a>` : title;
  // The category emoji IS the bullet (falls back to • when there's no category).
  const bullet = CAT_EMOJI[e.categoryTag ?? ""] ?? "•";
  const parts = [fmtWhen(e.startsAt, tz)];
  // Only show attendance when we actually have it — a null/0 count is "unknown",
  // not "zero people", and a fabricated "👥 0" reads as a dead event.
  if (e.guestCount != null && e.guestCount > 0) parts.push(`👥 ${e.guestCount}`);
  // The title links to the primary source; if the same event is also listed
  // elsewhere (e.g. the host's own site), offer those as extra links.
  for (const alt of e.links.slice(1)) {
    parts.push(`<a href="${urlAttr(alt.url)}">${htmlEscape(alt.label)}</a>`);
  }
  let block = `${bullet} ${link}\n${parts.join(" · ")}`;
  if (e.speakerNames.length) {
    // Mic trails the names (see the legend: 🎤 = who's speaking).
    block += `\n${htmlEscape(e.speakerNames.slice(0, 3).join(", "))} 🎤`;
  }
  return block;
}

/** Compact one-message renderer shared by scheduled digests + the on-demand bot.
 *  `totalCount` is how many events matched before any trimming, so the footer can
 *  point at the rest on the web. */
export function renderEventsMessage(
  header: string,
  events: DeliveryEvent[],
  tz: string,
  totalCount = events.length,
): string {
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
        out.push(`\n… +${totalCount - shown} more at ${siteUrl()}`);
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
  if (totalCount > shown) out.push(`\n… +${totalCount - shown} more at ${siteUrl()}`);
  return out.join("\n");
}

/** Keep every top-tier event, drop most of the tail.
 *
 *  The daily digest is a scan-in-ten-seconds evening note, not the full board:
 *  an unabridged list ran ~22 events and filled the whole message. Must Attend
 *  is never trimmed — those are the reason to read it — while the lower tiers
 *  keep only their best few, ranked by score, and the footer links to the rest. */
export function trimForDaily(
  events: DeliveryEvent[],
  keepRatio = Number(process.env.DAILY_LOWER_TIER_KEEP ?? 0.4),
): DeliveryEvent[] {
  const top = events.filter((e) => e.tier === "dont_miss");
  const rest = events
    .filter((e) => e.tier !== "dont_miss")
    .sort((a, b) => b.score - a.score || a.startsAt.getTime() - b.startsAt.getTime());
  // At least one lower-tier pick survives, so a quiet day isn't only Must Attend.
  const keep = rest.length ? Math.max(1, Math.floor(rest.length * keepRatio)) : 0;
  return [...top, ...rest.slice(0, keep)];
}

function digestHeader(
  feed: FeedRow,
  events: DeliveryEvent[],
  kind: DigestKind,
  tz: string,
  count = events.length,
): string {
  const legend = DIGEST_LEGEND;
  if (kind === "daily") {
    // Evening digest for the NEXT day — label it with tomorrow's actual date.
    const day = events.length
      ? DateTime.fromJSDate(events[0].startsAt, { zone: "utc" }).setZone(tz)
      : DateTime.now().setZone(tz).plus({ days: 1 });
    return `☀️ <b>Bay Area Events — Tomorrow, ${day.toFormat("ccc LLL d")}</b>\n📊 ${count} curated events | ${legend}`;
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
  // The daily is a short evening note: all of Must Attend, only the best of the
  // rest. The weekly stays the full board.
  const shown = kind === "daily" ? trimForDaily(events) : events;
  // Sort by start time for the header range calc; sections re-sort by score.
  const byDate = [...shown].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  // Header counts the whole day; the footer points at what didn't fit.
  return renderEventsMessage(
    digestHeader(feed, byDate, kind, tz, events.length),
    shown,
    tz,
    events.length,
  );
}

export function quietWeekMessage(): string {
  return (
    `📅 <b>Bay Area Events — The Week Ahead</b>\n\n` +
    `A quiet week — nothing cleared the bar this time. We only send events genuinely worth ` +
    `your evening, so no filler. Back with the next standout.`
  );
}
