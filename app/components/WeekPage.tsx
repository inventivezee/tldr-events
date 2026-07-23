import type { Tier } from "@/types";
import { getWeekView } from "@/web/data";
import { Filters } from "./Filters";
import { TierGroup } from "./TierGroup";
import { FollowButton } from "./FollowButton";

export async function WeekPage({
  which,
  searchParams,
}: {
  which: "this" | "next";
  searchParams: { cat?: string; tier?: string };
}) {
  const cat = searchParams.cat;
  const tier = (searchParams.tier as Tier) || undefined;
  const basePath = which === "this" ? "/" : "/next-week";

  const view = await getWeekView({ which, categoryTag: cat, tier });

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

  const heading = which === "this" ? "This Week" : "Next Week";

  return (
    <div>
      <section className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{heading}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {view.meta.name}. The handful of events actually worth your time — ranked,
          with a one-line reason each made the cut. Times in PT (localized to you).
        </p>
      </section>

      <Filters
        basePath={basePath}
        categories={view.categories}
        cat={cat}
        tier={tier}
      />

      {view.events.length === 0 ? (
        <div
          className="rounded-xl p-6 text-center"
          style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
        >
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Nothing clears the bar for this view yet. We only surface events genuinely
            worth your evening — check back soon, or follow along on Telegram.
          </p>
          <div className="mt-4 flex justify-center">
            <FollowButton />
          </div>
        </div>
      ) : (
        <>
          {view.tiers.map((g) => (
            <TierGroup
              key={g.tier}
              tier={g.tier}
              events={g.events}
              feedId={view.meta.id}
              tz={view.meta.timezone}
            />
          ))}
          <div className="mt-8 flex justify-center">
            <FollowButton />
          </div>
        </>
      )}
    </div>
  );
}
