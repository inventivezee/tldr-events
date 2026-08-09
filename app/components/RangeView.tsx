import { getBoardView, type BoardRange } from "@/web/data";
import { boardJsonLd, jsonLdScript } from "@/web/structured-data";
import { EventsBoard } from "./EventsBoard";

export async function RangeView({
  range,
  dayLabel,
  path,
  seoTitle,
  seoDescription,
}: {
  range: BoardRange;
  dayLabel?: string;
  /** Canonical path of the page, used to self-reference in structured data. */
  path: string;
  seoTitle: string;
  seoDescription: string;
}) {
  const board = await getBoardView(range);

  if (!board) {
    return (
      <div className="site-shell">
        <main style={{ padding: "60px 40px" }}>
          <h1 style={{ fontSize: 32 }}>Setup in progress</h1>
          <p style={{ color: "var(--muted)", marginTop: 16 }}>
            The feed isn&rsquo;t reachable yet. Once the database is seeded and the
            pipeline runs, ranked events appear here.
          </p>
        </main>
      </div>
    );
  }

  // Describe only what a visitor actually sees by default: curated events above
  // the board's floor, in the order shown. Marking up the hidden tail would
  // claim more than the page delivers.
  const visible = board.events
    .filter((e) => e.relevant && e.score >= 6.5)
    .sort((a, b) => b.score - a.score);

  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            boardJsonLd({
              base,
              path,
              title: seoTitle,
              description: seoDescription,
              events: visible,
            }),
          ),
        }}
      />
      <EventsBoard
        events={board.events}
        horizonKey={board.horizonKey}
        horizons={board.horizons}
        telegramUrl={board.telegramUrl}
        calendar={board.calendar}
        activeDay={board.activeDay}
        dayLabel={dayLabel}
        extendedNote={board.extendedNote}
      />
    </>
  );
}
