"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { BoardEvent, BoardTier, HorizonMeta } from "@/web/board-types";

const TIER_META: Record<BoardTier, { label: string; icon: string; rank: number }> = {
  must_attend: { label: "Must Attend", icon: "🔥", rank: 0 },
  strong_pick: { label: "Strong Pick", icon: "⭐", rank: 1 },
  worth_a_look: { label: "Worth a Look", icon: "👀", rank: 2 },
};
const TIER_ORDER: BoardTier[] = ["must_attend", "strong_pick", "worth_a_look"];
const BAY_TZ = "America/Los_Angeles";

function formatEventTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  })
    .format(new Date(iso))
    .replace(",", " ·");
}

function zoneLabelOf(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(
    new Date(),
  );
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "PT";
}

export function EventsBoard({
  events,
  horizonKey,
  horizons,
  telegramUrl,
}: {
  events: BoardEvent[];
  horizonKey: string;
  horizons: HorizonMeta[];
  telegramUrl: string | null;
}) {
  const horizon = horizons.find((h) => h.key === horizonKey) ?? horizons[0];
  const [mode, setMode] = useState<"tldr" | "all">("tldr");
  const [category, setCategory] = useState<string>("All");
  const [tier, setTier] = useState<"all" | BoardTier>("all");
  const [showLow, setShowLow] = useState(false);
  const [displayTz, setDisplayTz] = useState(BAY_TZ);
  // Event whose source links are being chosen (multi-source events only).
  const [chooser, setChooser] = useState<BoardEvent | null>(null);

  useEffect(() => {
    setCategory("All");
    setTier("all");
    setShowLow(false);
  }, [horizonKey, mode]);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) setDisplayTz(tz);
  }, []);

  const zoneLabel = zoneLabelOf(displayTz);

  // TLDR = industry-relevant AND scoring above 4.0 (events at/below 4.0 drop out
  // of the curated feed and live only in All). All = everything (incl. non-relevant
  // noise and the sub-4.0 tail).
  const inMode = useMemo(
    () => (mode === "tldr" ? events.filter((e) => e.relevant && e.score > 4.0) : events),
    [events, mode],
  );

  const categoryOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of inMode) if (!seen.has(e.categoryKey)) seen.set(e.categoryKey, e.category);
    return ["All", ...[...seen.values()]];
  }, [inMode]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: inMode.length };
    for (const opt of categoryOptions) {
      if (opt === "All") continue;
      counts[opt] = inMode.filter((e) => e.category === opt).length;
    }
    return counts;
  }, [inMode, categoryOptions]);

  const filtered = useMemo(
    () =>
      inMode
        .filter((e) => category === "All" || e.category === category)
        .filter((e) => tier === "all" || e.tier === tier)
        .sort((a, b) => b.score - a.score),
    [inMode, category, tier],
  );

  const topScore = filtered[0]?.score ?? inMode[0]?.score ?? 0;
  const mustAttendCount = inMode.filter((e) => e.tier === "must_attend").length;
  const avgScore =
    inMode.reduce((s, e) => s + e.score, 0) / Math.max(1, inMode.length);

  const rankOf = (id: string) => filtered.findIndex((e) => e.id === id) + 1;

  return (
    <div className="site-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="TLDR Events home">
          <span className="brand-mark" aria-hidden="true" />
          <span>TLDR EVENTS</span>
        </Link>

        <div className="system-status" aria-label="Feed status">
          <span>
            <i className="live-dot" aria-hidden="true" />
            {mode === "tldr" ? "Curated feed" : "All events"}
          </span>
          <span>SF Bay Area / {zoneLabel}</span>
        </div>

        {telegramUrl ? (
          <a className="telegram" href={telegramUrl} target="_blank" rel="noopener noreferrer">
            Join on Telegram <span aria-hidden="true">↗</span>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <span />
        )}
      </header>

      <main>
        <section className="hero" aria-labelledby="page-title">
          <div className="hero-copy">
            <p className="eyebrow">Event intelligence / ranked daily</p>
            <h1 id="page-title">
              The Bay Area&rsquo;s best events&mdash;
              <span>ranked by signal.</span>
            </h1>
            <p className="subcopy">
              Curated for founders and investors. Every event scored, researched, and
              summarized so you can skip the firehose.
            </p>
          </div>

          <aside className="signal-summary" aria-label={`${horizon.label} summary`}>
            <p className="summary-kicker">{horizon.label} signal snapshot</p>
            <div className="summary-main">
              <div className="top-score">
                <strong>{topScore.toFixed(1)}</strong>
                <span>Top signal</span>
              </div>
              <dl className="summary-stats">
                <div>
                  <dt>{mode === "tldr" ? "Relevant" : "All"}</dt>
                  <dd>{String(inMode.length).padStart(2, "0")}</dd>
                </div>
                <div>
                  <dt>Must attend</dt>
                  <dd>{String(mustAttendCount).padStart(2, "0")}</dd>
                </div>
                <div>
                  <dt>Avg score</dt>
                  <dd>{avgScore.toFixed(1)}</dd>
                </div>
              </dl>
            </div>
            <div className="coverage">
              <span>Live data · best first</span>
              <span className="coverage-bar" aria-hidden="true">
                <span />
              </span>
            </div>
          </aside>
        </section>

        <nav className="horizon-nav" aria-label="Browse events by date range">
          {horizons.map((item) => {
            const isActive = item.key === horizonKey;
            return (
              <Link
                className={`horizon-link${isActive ? " is-active" : ""}`}
                href={item.path}
                aria-current={isActive ? "page" : undefined}
                key={item.key}
              >
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.meta}</small>
                </span>
                <span className="horizon-date">
                  <b>{item.date}</b>
                  <small>{item.dateLabel}</small>
                </span>
              </Link>
            );
          })}
        </nav>

        <section className="board-head" aria-labelledby="board-title">
          <div className="board-title">
            <h2 id="board-title">{horizon.boardLabel}</h2>
            <p>
              {horizon.longDate} · {mode === "tldr" ? "Curated" : "All events"} · Times in{" "}
              {zoneLabel}
            </p>
          </div>

          <div className="filters" aria-label="Filter ranked events">
            <span className="filter-label">View</span>
            <span className="mode-toggle" role="group" aria-label="Feed mode">
              <a
                className={mode === "tldr" ? "is-active" : ""}
                aria-pressed={mode === "tldr"}
                role="button"
                tabIndex={0}
                onClick={() => setMode("tldr")}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setMode("tldr")}
              >
                TLDR
              </a>
              <a
                className={mode === "all" ? "is-active" : ""}
                aria-pressed={mode === "all"}
                role="button"
                tabIndex={0}
                onClick={() => setMode("all")}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setMode("all")}
              >
                All
              </a>
            </span>

            <span className="filter-label">Topic</span>
            {categoryOptions.map((option) => {
              const isActive = option === category;
              return (
                <button
                  className={`filter-button${isActive ? " is-active" : ""}`}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setCategory(option)}
                  key={option}
                >
                  {option} {String(categoryCounts[option] ?? 0).padStart(2, "0")}
                </button>
              );
            })}

            <label className="tier-filter">
              <span className="sr-only">Filter by event tier</span>
              <select value={tier} onChange={(e) => setTier(e.target.value as "all" | BoardTier)}>
                <option value="all">Tier: All</option>
                <option value="must_attend">Tier: Must Attend</option>
                <option value="strong_pick">Tier: Strong Pick</option>
                <option value="worth_a_look">Tier: Worth a Look</option>
              </select>
            </label>
          </div>
        </section>

        <section className="feed" aria-label={`Ranked ${horizon.label.toLowerCase()} events`}>
          <p className="result-count" aria-live="polite">
            Showing {filtered.length} of {inMode.length}{" "}
            {mode === "tldr" ? "relevant" : ""} events
          </p>

          {filtered.length === 0 ? (
            <div className="empty-state">
              <p>No events match these filters.</p>
              <button
                type="button"
                onClick={() => {
                  setCategory("All");
                  setTier("all");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            TIER_ORDER.map((tierKey) => {
              const tierEvents = filtered.filter((e) => e.tier === tierKey);
              if (tierEvents.length === 0) return null;
              const info = TIER_META[tierKey];
              const isLow = tierKey === "worth_a_look";
              const collapsed = isLow && !showLow && tier === "all";

              return (
                <section className="tier-group" key={tierKey}>
                  <div className="tier-heading">
                    <h3>
                      <span aria-hidden="true">{info.icon}</span>
                      {info.label}
                    </h3>
                    <span>
                      Tier {String(info.rank + 1).padStart(2, "0")} · {tierEvents.length}{" "}
                      {tierEvents.length === 1 ? "event" : "events"}
                    </span>
                  </div>

                  {collapsed ? (
                    <button className="show-more" type="button" onClick={() => setShowLow(true)}>
                      👀 Show {tierEvents.length} lower-ranked{" "}
                      {tierEvents.length === 1 ? "event" : "events"}
                    </button>
                  ) : (
                    <div className="event-list">
                      {tierEvents.map((event) => (
                        <EventRow
                          key={event.id}
                          event={event}
                          rank={rankOf(event.id)}
                          tz={displayTz}
                          onChoose={setChooser}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </section>
      </main>

      <footer>
        <p>
          TLDR Events aggregates and curates Bay Area events for founders and investors. We
          link out to each source and don&rsquo;t sell tickets or collect RSVPs.
        </p>
        {telegramUrl ? (
          <a href={telegramUrl} target="_blank" rel="noopener noreferrer">
            Get the Bay Area digest on Telegram<span aria-hidden="true"> ↗</span>
          </a>
        ) : null}
      </footer>

      {chooser ? <LinkChooser event={chooser} onClose={() => setChooser(null)} /> : null}
    </div>
  );
}

/** Chooser for an event listed in more than one place — e.g. a Luma registration
 *  page and the host's own site. Opens when the card (not a specific link) is
 *  clicked. */
function LinkChooser({ event, onClose }: { event: BoardEvent; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="link-modal-backdrop" onClick={onClose}>
      <div
        className="link-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <small>Listed in {event.links.length} places</small>
        <strong id="link-modal-title">{event.title}</strong>
        <div className="link-modal-actions">
          {event.links.map((l, i) => (
            <a
              key={l.clickUrl}
              href={l.clickUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              autoFocus={i === 0}
              onClick={onClose}
            >
              View on {l.label}
              <i aria-hidden="true">↗</i>
            </a>
          ))}
        </div>
        <button type="button" className="link-modal-close" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function EventRow({
  event,
  rank,
  tz,
  onChoose,
}: {
  event: BoardEvent;
  rank: number;
  tz: string;
  onChoose: (event: BoardEvent) => void;
}) {
  const info = TIER_META[event.tier];
  const details = [
    formatEventTime(event.startsAt, tz),
    event.venue,
    event.city,
  ].filter(Boolean) as string[];

  // This event is listed in more than one place (e.g. Luma + the host's own
  // site). A card can't be one big <a> then — the per-source links live inside
  // it — so it becomes a button that opens the chooser.
  const multi = event.links.length > 1;
  const cardClass = `event-card${rank === 1 ? " top-ranked" : ""}${multi ? " multi-link" : ""}`;
  const inner = (
    <>
      <span className="rank" aria-label={`Rank ${rank}`}>
        {String(rank).padStart(2, "0")}
      </span>
        <span className="score" aria-label={`${event.score.toFixed(1)} out of 10`}>
          <strong>{event.score.toFixed(1)}</strong>
          <small>Signal / 10</small>
          <i aria-hidden="true">
            <span style={{ width: `${Math.min(100, event.score * 10)}%` }} />
          </i>
        </span>

        <span className="event-main">
          <span className="event-topline">
            <span className={`tier-badge ${event.tier}`}>
              <span aria-hidden="true">{info.icon}</span>
              {info.label}
            </span>
            <span className="category-badge">{event.category}</span>
          </span>
          <strong className="event-title">{event.title}</strong>
          <span className="event-details">
            <time dateTime={event.startsAt}>{details[0]}</time>
            {details.slice(1).map((d, i) => (
              <span key={i}>
                <span aria-hidden="true">·</span> {d}
              </span>
            ))}
          </span>
          {event.tldr ? (
            <span className="event-tldr">
              <b>TLDR</b>
              {event.tldr}
            </span>
          ) : null}
        </span>

      <span className="room-signal">
        <small>Room signal</small>
        <strong>
          {event.guestCount && event.guestCount > 0
            ? `${event.guestCount.toLocaleString()} going`
            : "Room TBD"}
        </strong>
        <span>{event.notables.length ? event.notables.join(" · ") : "Hosts not yet researched"}</span>
      </span>
    </>
  );

  if (!multi) {
    return (
      <article>
        <a
          className={cardClass}
          href={event.clickUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={`View ${event.title} on ${event.source}; opens in a new tab`}
        >
          {inner}
          <span className="event-action">
            <span>
              View on {event.source}
              <i aria-hidden="true">↗</i>
            </span>
          </span>
        </a>
      </article>
    );
  }

  // Multi-source: the card itself opens the chooser; the individual links stay
  // directly clickable on the right (stopPropagation so they don't also open it).
  return (
    <article>
      <div
        className={cardClass}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-label={`${event.title} — listed in ${event.links.length} places; choose where to open`}
        onClick={() => onChoose(event)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onChoose(event);
          }
        }}
      >
        {inner}
        <span className="event-action multi">
          {event.links.map((l) => (
            <a
              key={l.clickUrl}
              href={l.clickUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={(e) => e.stopPropagation()}
            >
              View on {l.label}
              <i aria-hidden="true">↗</i>
            </a>
          ))}
        </span>
      </div>
    </article>
  );
}
