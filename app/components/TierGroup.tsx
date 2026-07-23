import type { Tier } from "@/types";
import type { DeliveryEvent } from "@/digest/query";
import { TIER_ICON, TIER_LABEL } from "@/scoring/tiers";
import { EventCard } from "./EventCard";

export function TierGroup({
  tier,
  events,
  feedId,
  tz,
}: {
  tier: Tier;
  events: DeliveryEvent[];
  feedId: string;
  tz: string;
}) {
  if (!events.length) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
        <span aria-hidden>{TIER_ICON[tier]}</span>
        <span>{TIER_LABEL[tier]}</span>
        <span style={{ color: "var(--muted)" }}>· {events.length}</span>
      </h2>
      <div className="flex flex-col gap-3">
        {events.map((e) => (
          <EventCard key={e.id} event={e} feedId={feedId} tz={tz} />
        ))}
      </div>
    </section>
  );
}
