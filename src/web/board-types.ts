// Plain, dependency-free types shared between the server data layer and the
// client EventsBoard component.

export type BoardTier = "must_attend" | "strong_pick" | "worth_a_look";

export interface BoardEvent {
  id: string;
  title: string;
  category: string; // display label, e.g. "AI"
  categoryKey: string; // scores.category_tag
  score: number;
  tier: BoardTier;
  relevant: boolean;
  startsAt: string; // ISO
  venue: string | null;
  city: string | null;
  guestCount: number | null;
  notables: string[];
  tldr: string | null;
  source: string; // e.g. "Luma" — label of the primary link
  clickUrl: string; // primary destination (click-tracked)
  /** Every distinct destination. Length > 1 → the card offers a choice
   *  (e.g. a Luma registration page AND the host's own site). */
  links: BoardEventLink[];
}

export interface BoardEventLink {
  label: string; // e.g. "Luma", "Official site"
  clickUrl: string; // click-tracked path
}

/** One day in the browse calendar. `count` is the curated (TLDR) event count, so
 *  the calendar advertises the same set the default board view shows. */
export interface CalendarDay {
  date: string; // local ISO date, e.g. "2026-07-30"
  dow: string; // "Thu"
  dayOfMonth: number;
  month: string; // "Jul"
  count: number;
  topScore: number | null;
  isToday: boolean;
  isPast: boolean;
}

export interface HorizonMeta {
  key: string; // today | tomorrow | this-week | next-week
  label: string;
  path: string;
  date: string; // e.g. "23" or "23–26"
  dateLabel: string; // e.g. "Thu / Jul"
  meta: string;
  boardLabel: string;
  longDate: string;
}
