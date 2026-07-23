import { getBoardView, type RangeKey } from "@/web/data";
import { EventsBoard } from "./EventsBoard";

export async function RangeView({ range }: { range: RangeKey }) {
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

  return (
    <EventsBoard
      events={board.events}
      horizonKey={board.horizonKey}
      horizons={board.horizons}
      telegramUrl={board.telegramUrl}
    />
  );
}
