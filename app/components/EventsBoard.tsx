"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardEvent, BoardTier, CalendarDay, HorizonMeta } from "@/web/board-types";

const TIER_META: Record<BoardTier, { label: string; icon: string; rank: number }> = {
  must_attend: { label: "Must Attend", icon: "🔥", rank: 0 },
  strong_pick: { label: "Strong Pick", icon: "⭐", rank: 1 },
  worth_a_look: { label: "Worth a Look", icon: "👀", rank: 2 },
};
const TIER_ORDER: BoardTier[] = ["must_attend", "strong_pick", "worth_a_look"];
const TIER_FILTERS: { value: "all" | BoardTier; label: string }[] = [
  { value: "all", label: "All tiers" },
  { value: "must_attend", label: "🔥 Must Attend" },
  { value: "strong_pick", label: "⭐ Strong Pick" },
  { value: "worth_a_look", label: "👀 Worth a Look" },
];
const BAY_TZ = "America/Los_Angeles";
/** Score a board event must clear to appear in the main list. Anything relevant
 *  but below it stays one tap away behind "show lower-ranked", so the default
 *  view is only the events genuinely worth an evening. */
const VISIBLE_MIN_SCORE = 6.5;

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

/** Telegram's paper-plane mark, inlined so it needs no network request. */
function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M21.94 4.3 19.2 19.1c-.2 1.1-.85 1.37-1.72.85l-4.75-3.5-2.29 2.2c-.25.25-.47.47-.95.47l.34-4.84 8.82-7.97c.38-.34-.08-.53-.6-.19L6.16 13.3l-4.67-1.46c-1.01-.32-1.03-1.01.21-1.5l18.2-7.02c.85-.31 1.59.2 1.24 2.98Z"
      />
    </svg>
  );
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
  calendar,
  activeDay,
  dayLabel,
}: {
  events: BoardEvent[];
  horizonKey: string;
  horizons: HorizonMeta[];
  telegramUrl: string | null;
  calendar: CalendarDay[];
  activeDay: string | null;
  dayLabel?: string;
}) {
  const horizon = horizons.find((h) => h.key === horizonKey) ?? horizons[0];
  const [category, setCategory] = useState<string>("All");
  const [tier, setTier] = useState<"all" | BoardTier>("all");
  const [showLow, setShowLow] = useState(false);
  const [displayTz, setDisplayTz] = useState(BAY_TZ);
  // Event whose source links are being chosen (multi-source events only).
  const [chooser, setChooser] = useState<BoardEvent | null>(null);
  const datePicker = useRef<HTMLDetailsElement>(null);

  // The calendar is worth showing outright where there's room, and worth
  // collapsing where there isn't. Rather than pick one, follow the viewport:
  // open by default on a wide screen, closed on a phone. Only re-applied when
  // the breakpoint is actually CROSSED, so it never reopens itself while
  // someone is scrolling or fights a panel they just closed.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1000px)");
    const apply = () => {
      if (datePicker.current) datePicker.current.open = wide.matches;
    };
    apply();
    wide.addEventListener("change", apply);
    return () => wide.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    setCategory("All");
    setTier("all");
    setShowLow(false);
  }, [horizonKey]);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) setDisplayTz(tz);
  }, []);

  const zoneLabel = zoneLabelOf(displayTz);

  // One list, always curated: industry-relevant and above the 4.0 floor. The
  // TLDR/All toggle is gone — the floor plus the collapsed lower tier already do
  // the filtering it offered, and it cost a row of chrome on every screen.
  const inMode = useMemo(
    () => events.filter((e) => e.relevant && e.score > 4.0),
    [events],
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
  // A single-day view isn't one of the four horizons, so it carries its own label.
  const boardLabel = dayLabel ? `${dayLabel}` : horizon.boardLabel;
  const boardDate = dayLabel ?? horizon.longDate;

  // Explicitly picking a tier means you asked for those events, so the score
  // cutoff steps aside; otherwise the tail hides behind the button.
  const cutoffApplies = tier === "all" && !showLow;
  const shown = cutoffApplies
    ? filtered.filter((e) => e.score >= VISIBLE_MIN_SCORE)
    : filtered;
  const hiddenCount = filtered.length - shown.length;

  const rankOf = (id: string) => filtered.findIndex((e) => e.id === id) + 1;

  // The horizon you're on leads the nav; the rest shrink to chips. A single-day
  // view belongs to no horizon, so nothing is promoted.
  const primaryHorizon = activeDay ? null : horizon;
  const otherHorizons = horizons.filter((h) => h.key !== primaryHorizon?.key);

  // Collapsed panels must still say what's active, or a filter set earlier looks
  // like missing events.
  const filterSummary =
    [category !== "All" ? category : null, TIER_FILTERS.find((t) => t.value === tier)?.label]
      .filter((x) => x && x !== "All tiers")
      .join(" · ") || "None";

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
            Curated feed
          </span>
          <span>SF Bay Area / {zoneLabel}</span>
        </div>

        {telegramUrl ? (
          <a className="telegram" href={telegramUrl} target="_blank" rel="noopener noreferrer">
            <TelegramIcon />
            <span className="telegram-label">
              Join On <b>Telegram</b>
            </span>
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

          {/* Beside the headline on a wide screen — that column was empty, and the
              calendar is more useful there than more height below. Collapsed into
              tap-to-open bars on a phone. */}
          <div className="pickers">
            <details className="picker" ref={datePicker}>
              <summary>
                <span className="picker-title">Select by date</span>
                <span className="picker-hint">{activeDay ? dayLabel : "4 weeks"}</span>
                <span className="picker-chevron" aria-hidden="true" />
              </summary>
              <BrowseCalendar days={calendar} activeDay={activeDay} topScore={topScore} />
            </details>

            <details className="picker">
              <summary>
                <span className="picker-title">Filters</span>
                <span className="picker-hint">{filterSummary}</span>
                <span className="picker-chevron" aria-hidden="true" />
              </summary>
              <div className="filters" aria-label="Filter ranked events">
                <span className="filter-label">Topic</span>
                <div className="filter-row">
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
                </div>

                <span className="filter-label">Tier</span>
                <div className="filter-row">
                  {TIER_FILTERS.map((t) => {
                    const isActive = tier === t.value;
                    return (
                      <button
                        className={`filter-button${isActive ? " is-active" : ""}`}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => setTier(t.value)}
                        key={t.value}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>

                {(category !== "All" || tier !== "all") && (
                  <button
                    className="filter-clear"
                    type="button"
                    onClick={() => {
                      setCategory("All");
                      setTier("all");
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </details>
          </div>
        </section>

        {/* The active horizon leads at full size; the others stay as compact
            chips, so the nav costs one band instead of four. */}
        <nav className="horizon-nav" aria-label="Browse events by date range">
          {primaryHorizon ? (
            <Link
              className="horizon-link is-primary"
              href={primaryHorizon.path}
              aria-current="page"
            >
              <span>
                <strong>{primaryHorizon.label}</strong>
                <small>{primaryHorizon.meta}</small>
              </span>
              <span className="horizon-date">
                <b>{primaryHorizon.date}</b>
                <small>{primaryHorizon.dateLabel}</small>
              </span>
            </Link>
          ) : null}
          <div className="horizon-chips">
            {otherHorizons.map((item) => (
              <Link className="horizon-chip" href={item.path} key={item.key}>
                <strong>{item.label}</strong>
                <small>{item.date}</small>
              </Link>
            ))}
          </div>
        </nav>


        <section className="board-head" aria-labelledby="board-title">
          <div className="board-title">
            <h2 id="board-title">{boardLabel}</h2>
            <p>
              {boardDate} · Times in {zoneLabel}
            </p>
          </div>

        </section>

        <section className="feed" aria-label={`Ranked ${horizon.label.toLowerCase()} events`}>
          {category !== "All" || tier !== "all" ? (
            <p className="result-count" aria-live="polite">
              Showing {shown.length} of {filtered.length} events
            </p>
          ) : null}

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
            <>
              {TIER_ORDER.map((tierKey) => {
                const tierEvents = shown.filter((e) => e.tier === tierKey);
                if (tierEvents.length === 0) return null;
                const info = TIER_META[tierKey];
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
                  </section>
                );
              })}

              {hiddenCount > 0 ? (
                <button className="show-more" type="button" onClick={() => setShowLow(true)}>
                  👀 Show {hiddenCount} lower-ranked{" "}
                  {hiddenCount === 1 ? "event" : "events"}
                </button>
              ) : null}
            </>
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

/** Four weeks at a glance: how many curated events land on each day, so a week
 *  can be planned without clicking through each horizon. Each day links to its
 *  own page. Replaces the old stat panel — the counts are the useful signal. */
function BrowseCalendar({
  days,
  activeDay,
  topScore,
}: {
  days: CalendarDay[];
  activeDay: string | null;
  topScore: number;
}) {
  const weeks: CalendarDay[][] = [];
  // Pad so the grid starts on Monday, matching how the week views are defined.
  const lead = days.length ? (new Date(`${days[0].date}T12:00:00`).getDay() + 6) % 7 : 0;
  const padded: (CalendarDay | null)[] = [...Array(lead).fill(null), ...days];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7) as CalendarDay[]);
  const busiest = Math.max(1, ...days.map((d) => d.count));

  return (
    <aside className="browse-calendar" aria-label="Events by date">
      <div className="calendar-head">
        <p className="summary-kicker">Events by date</p>
        <span className="calendar-top">
          <strong>{topScore.toFixed(1)}</strong> top signal
        </span>
      </div>

      <div className="calendar-dow" aria-hidden="true">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>

      <div className="calendar-grid" role="list">
        {weeks.map((week, wi) =>
          week.map((day, di) => {
            if (!day) return <span className="calendar-cell is-empty" key={`${wi}-${di}`} />;
            const heat = day.count ? Math.max(0.18, day.count / busiest) : 0;
            const isActive = day.date === activeDay;
            const label = `${day.dow} ${day.month} ${day.dayOfMonth}: ${day.count} ${
              day.count === 1 ? "event" : "events"
            }`;
            return (
              <Link
                role="listitem"
                key={day.date}
                href={`/day/${day.date}`}
                className={`calendar-cell${day.isToday ? " is-today" : ""}${
                  isActive ? " is-active" : ""
                }${day.count ? "" : " is-quiet"}`}
                aria-label={label}
                aria-current={isActive ? "page" : undefined}
                title={label}
              >
                <b>{day.dayOfMonth}</b>
                {day.count ? (
                  <i style={{ opacity: heat }} aria-hidden="true">
                    {day.count}
                  </i>
                ) : (
                  <i className="none" aria-hidden="true">
                    ·
                  </i>
                )}
              </Link>
            );
          }),
        )}
      </div>
      <p className="calendar-foot">Pick a day to see everything on it.</p>
    </aside>
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
          <h4 className="event-title">{event.title}</h4>
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
