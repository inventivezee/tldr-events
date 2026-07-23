import type { DeliveryEvent } from "@/digest/query";
import { fmtLocalDate, fmtLocalTime } from "@/lib/time";
import { TIER_ICON, categoryLabel } from "@/scoring/tiers";
import { clickUrl } from "@/lib/links";
import { EventTime } from "./EventTime";

export function EventCard({
  event,
  feedId,
  tz,
}: {
  event: DeliveryEvent;
  feedId: string;
  tz: string;
}) {
  const ptLabel = `${fmtLocalDate(event.startsAt, tz)} · ${fmtLocalTime(event.startsAt, tz)} PT`;
  const href = clickUrl(event.id, feedId, "web");
  const tag = categoryLabel(event.categoryTag);

  return (
    <article
      className="rounded-xl p-4 transition-colors"
      style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>
            {TIER_ICON[event.tier]}
          </span>
          <span
            className="rounded-md px-2 py-0.5 text-sm font-bold"
            style={{ background: "var(--panel-2)", color: "var(--accent)" }}
          >
            {event.score.toFixed(1)}/10
          </span>
        </div>
        {tag ? (
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {tag}
          </span>
        ) : null}
      </div>

      <h3 className="mt-2 text-base font-semibold leading-snug">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="hover:underline"
        >
          {event.title}
        </a>
      </h3>

      <div className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        🕐 <EventTime iso={event.startsAt.toISOString()} ptLabel={ptLabel} />
        {event.city ? <> · 📍 {event.city}</> : null}
        {event.guestCount && event.guestCount > 0 ? <> · 👥 {event.guestCount}</> : null}
      </div>

      {event.notable.length > 0 ? (
        <div className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          🎤{" "}
          {event.notable
            .map((p) => (p.company ? `${p.name} (${p.company})` : p.name))
            .join(", ")}
        </div>
      ) : null}

      {event.tldr ? <p className="mt-2 text-sm leading-relaxed">{event.tldr}</p> : null}
    </article>
  );
}
