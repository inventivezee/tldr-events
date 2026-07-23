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
  searchParams: { cat?: string; tier?: string };
}) {
  const cat = searchParams.cat;
  const tier = (searchParams.tier as Tier) || undefined;
  const { heading, blurb, path } = RANGE_META[range];

  const view = await getRangeView({ range, categoryTag: cat, tier });

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

  return (
    <div>
      <section className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{heading}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {view.meta.name}. {blurb} Each event is scored out of 10 on who&apos;s in
          the room and why it matters. Times in PT (localized to you).
        </p>
      </section>

      <Filters basePath={path} categories={view.categories} cat={cat} tier={tier} />

      {view.events.length === 0 ? (
        <div
          className="rounded-xl p-6 text-center"
          style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
        >
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Nothing clears the bar for this view yet. We only surface events genuinely
            worth your time — check back soon, or follow along on Telegram.
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
