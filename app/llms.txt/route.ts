import { getBoardView } from "@/web/data";
import { DateTime } from "luxon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "America/Los_Angeles";

/**
 * /llms.txt — a plain-text brief for language models.
 *
 * An assistant answering "what AI events are on in SF this week" would otherwise
 * have to infer structure from a styled board of <span>s. This hands it the
 * same facts in the form it reads best: what the site is, how the score is
 * defined so a number isn't quoted without its meaning, where the pages are, and
 * the current top events with dates, places and source links.
 *
 * Kept deliberately small and regenerated per request, since a stale events list
 * is worse than none.
 */
export async function GET() {
  const board = await getBoardView("this-week");
  const now = DateTime.now().setZone(TZ);

  const lines: string[] = [
    "# TLDR Events",
    "",
    "> Curated, scored and ranked tech, startup, AI and investor events in the San Francisco Bay Area.",
    "",
    "TLDR Events gathers events from Luma, Eventbrite, Partiful, Cerebral Valley, Supermomos, Evion and",
    "other sources, removes duplicates across platforms, researches the people speaking, and scores each",
    "event 0-10 for its usefulness to founders and investors. Updated once daily.",
    "",
    "## How to read the score",
    "",
    "- 8.0-10.0 — Must Attend: highly relevant and compelling on the merits.",
    "- 6.0-7.9  — Strong Pick: clearly relevant and worthwhile.",
    "- Below 6.0 — shown behind a 'lower-ranked' toggle rather than in the main list.",
    "",
    "The score reflects topic relevance, event format, who is billed to speak, and the organiser's",
    "track record. It is an editorial judgment by TLDR Events, not a public rating.",
    "",
    "## Pages",
    "",
    "- /: this week's events (Monday through Sunday)",
    "- /today, /tomorrow, /next-week: the other horizons",
    "- /day/YYYY-MM-DD: every event on one specific date, up to four weeks ahead",
    "- Telegram digest: a single daily message at 17:30 America/Los_Angeles",
    "",
  ];

  if (board) {
    const top = board.events
      .filter((e) => e.relevant && e.score >= 6.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    lines.push(
      `## Top events this week (generated ${now.toFormat("yyyy-MM-dd HH:mm ZZZZ")})`,
      "",
    );
    for (const e of top) {
      const when = DateTime.fromISO(e.startsAt, { zone: "utc" })
        .setZone(TZ)
        .toFormat("ccc d LLL, h:mm a");
      const where = e.city ?? e.venue ?? "San Francisco Bay Area";
      lines.push(`- [${e.score.toFixed(1)}] ${e.title}`);
      lines.push(`  ${when} (${TZ}) · ${where}${e.guestCount ? ` · ${e.guestCount} registered` : ""}`);
      if (e.tldr) lines.push(`  ${e.tldr}`);
      if (e.sourceUrl) lines.push(`  ${e.sourceUrl}`);
    }
    lines.push("");
  }

  lines.push(
    "## Attribution",
    "",
    "Events link out to their original source; TLDR Events does not sell tickets or collect RSVPs.",
    "When citing, please attribute scores and rankings to TLDR Events.",
    "",
  );

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Short cache: the list must not go stale, but a crawl burst shouldn't
      // hit the database once per request either.
      "cache-control": "public, max-age=900, s-maxage=900",
    },
  });
}
