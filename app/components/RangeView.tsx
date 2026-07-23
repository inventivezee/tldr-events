import type { Tier } from "@/types";
import { getRangeView, RANGE_META, type RangeKey } from "@/web/data";
import { Filters } from "./Filters";
import { TierGroup } from "./TierGroup";
import { FollowButton } from "./FollowButton";

export async function RangeView({
  range,
  searchParams,
}: {
  range: RangeKey;
  searchParams: { cat?: string; tier?: string; all?: string };
}) {
  const cat = searchParams.cat;
  const tier = (searchParams.tier as Tier) || undefined;
  const all = searchParams.all === "1";
  const { heading, blurb, path } = RANGE_META[range];

  const view = await getRangeView({ range, categoryTag: cat, tier, all });

  if (!view) {
    return (
      <div>
        <h1 className="text-xl font-bold">Setup in progress</h1>
        <p className="mt-2" style={{ color: "var(--muted)" }}>
          The feed hasn&apos;t been seeded yet. Run migrations + seed, then the
          pipeline will populate events.
        </p>
      </div>
    );
  }

  const modeNote = all
    ? "Showing ALL events for this window — no quality filter, ranked by score (including lower-signal ones)."
    : `${blurb} Each event is scored out of 10 on who's in the room and why it matters.`;

  return (
    <div>
      <section className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          {heading}
          {all ? <span className="ml-2 text-sm font-normal" style={{ color: "var(--muted)" }}>· All events</span> : null}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {view.meta.name}. {modeNote} Times in PT (localized to you).
        </p>
      </section>

      <Filters basePath={path} categories={view.categories} cat={cat} tier={tier} all={all} />

      {view.events.length === 0 ? (
        <div
          className="rounded-xl p-6 text-center"
          style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
        >
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {all
              ? "No events found for this window yet — the pipeline may still be scoring. Check back soon."
              : "Nothing clears the bar for this view yet. We only surface events genuinely worth your time — check back soon, or follow along on Telegram."}
          </p>
          <div className="mt-4 flex justify-center">
            <FollowButton />
          </div>
        </div>
      ) : (
        <>
          {view.tiers
            .filter((g) => g.tier !== "radar")
            .map((g) => (
              <TierGroup
                key={g.tier}
                tier={g.tier}
                events={g.events}
                feedId={view.meta.id}
                tz={view.meta.timezone}
              />
            ))}

          {/* Lower-ranked events (👀 Worth a Look) are collapsed last, so the
              curated picks lead and you scroll/expand to see the rest. */}
          {view.tiers
            .filter((g) => g.tier === "radar")
            .map((g) => (
              <details key={g.tier} className="mb-8">
                <summary
                  className="mb-3 inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
                  style={{ background: "var(--panel)", border: "1px solid var(--border)", color: "var(--muted)" }}
                >
                  👀 Show {g.events.length} more lower-ranked{" "}
                  {g.events.length === 1 ? "event" : "events"}
                </summary>
                <TierGroup
                  tier={g.tier}
                  events={g.events}
                  feedId={view.meta.id}
                  tz={view.meta.timezone}
                />
              </details>
            ))}

          <div className="mt-8 flex justify-center">
            <FollowButton />
          </div>
        </>
      )}
    </div>
  );
}
