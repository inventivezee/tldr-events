// Telegram digest rendering (PRD §12.1, Appendix B). Tier-grouped, one block per
// event, per-event inline "View" button, split under the 4096-char limit.
import type { FeedRow } from "@/db/schema";
import type { DigestKind, Tier } from "@/types";
import type { DeliveryEvent, NotablePerson } from "./query";
import { fmtLocalTime, fmtLocalDate } from "@/lib/time";
import { TIER_ICON, TIER_LABEL, TIER_ORDER, categoryLabel } from "@/scoring/tiers";
import { htmlEscape, type InlineButton } from "@/telegram/api";
import { clickUrl } from "@/lib/links";

const MAX_CHARS = 3800; // safety margin under Telegram's 4096

export interface DigestChunk {
  html: string;
  buttons: InlineButton[];
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function notableText(notable: NotablePerson[]): string {
  if (!notable.length) return "";
  return notable
    .map((p) => {
      const org = p.company ? ` (${p.company})` : "";
      return `${htmlEscape(p.name)}${htmlEscape(org)}`;
    })
    .join(", ");
}

function eventBlock(e: DeliveryEvent, feedId: string, tz: string): DigestChunk {
  const icon = TIER_ICON[e.tier];
  const link = clickUrl(e.id, feedId, "telegram");
  const title = htmlEscape(truncate(e.title, 120));
  const score = e.score.toFixed(1);

  const meta: string[] = [`🕐 ${fmtLocalTime(e.startsAt, tz)}`];
  if (e.city) meta.push(`📍 ${htmlEscape(e.city)}`);
  if (e.guestCount != null && e.guestCount > 0) meta.push(`👥 ${e.guestCount}`);
  const notable = notableText(e.notable);
  if (notable) meta.push(`🎤 ${notable}`);
  const tag = categoryLabel(e.categoryTag);
  if (tag) meta.push(tag);

  const lines = [
    `${icon} <b>${score}/10</b> <a href="${link}">${title}</a>`,
    `   ${meta.join(" · ")}`,
  ];
  if (e.tldr) lines.push(`   ${htmlEscape(e.tldr)}`);

  return {
    html: lines.join("\n"),
    buttons: [{ text: `${icon} ${truncate(e.title, 40)}`, url: link }],
  };
}

function header(kind: DigestKind, events: DeliveryEvent[], tz: string): string {
  if (kind === "daily") {
    return `☀️ <b>TLDR Events — Today &amp; Tomorrow</b>`;
  }
  const start = events.length ? fmtLocalDate(events[0].startsAt, tz) : "";
  const end = events.length ? fmtLocalDate(events[events.length - 1].startsAt, tz) : "";
  const range = start && end ? ` (${start} – ${end})` : "";
  return `🗓️ <b>TLDR Events — The Week Ahead</b>${range}`;
}

export function quietWeek(): DigestChunk {
  return {
    html:
      `🗓️ <b>TLDR Events — The Week Ahead</b>\n\n` +
      `A quiet week — nothing cleared the bar this time. We only send events genuinely worth your evening, so no filler. Back with the next standout.`,
    buttons: [],
  };
}

export function renderDigestMessages(
  feed: FeedRow,
  events: DeliveryEvent[],
  kind: DigestKind,
  tz: string,
): DigestChunk[] {
  if (events.length === 0) {
    return kind === "weekly" ? [quietWeek()] : [];
  }
  return renderEventList(feed, events, header(kind, events, tz), tz);
}

/** Shared tier-grouped, chunked renderer for scheduled digests + on-demand bot. */
export function renderEventList(
  feed: FeedRow,
  events: DeliveryEvent[],
  headerText: string,
  tz: string,
): DigestChunk[] {
  if (events.length === 0) return [];

  // Tier groups, 🔥 first; within a tier, by start time.
  const tiers: Tier[] = ["dont_miss", "strong", "radar"];
  const grouped = new Map<Tier, DeliveryEvent[]>();
  for (const e of events) {
    const arr = grouped.get(e.tier) ?? [];
    arr.push(e);
    grouped.set(e.tier, arr);
  }

  const chunks: DigestChunk[] = [];
  let curHtml = headerText;
  let curButtons: InlineButton[] = [];

  const flush = () => {
    if (curHtml.trim()) chunks.push({ html: curHtml, buttons: curButtons });
    curHtml = "";
    curButtons = [];
  };
  const append = (piece: string, buttons: InlineButton[]) => {
    const candidate = curHtml ? `${curHtml}\n\n${piece}` : piece;
    if (candidate.length > MAX_CHARS && curHtml) {
      flush();
      curHtml = piece;
      curButtons = [...buttons];
    } else {
      curHtml = candidate;
      curButtons.push(...buttons);
    }
  };

  for (const tier of tiers.sort((a, b) => TIER_ORDER[a] - TIER_ORDER[b])) {
    const arr = (grouped.get(tier) ?? []).sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );
    if (!arr.length) continue;
    append(`${TIER_ICON[tier]} <b>${TIER_LABEL[tier]}</b>`, []);
    for (const e of arr) {
      const block = eventBlock(e, feed.id, tz);
      append(block.html, block.buttons);
    }
  }
  flush();
  return chunks;
}
