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
  source: string; // e.g. "Luma"
  clickUrl: string;
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
