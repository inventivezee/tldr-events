// Shared domain types used across ingestion, dedup, research, scoring, and delivery.

/** Canonical niche/category slugs (ingest hints + display). */
export type Category =
  | "ai"
  | "longevity"
  | "fintech_blockchain"
  | "founder_investor"
  | "hackathon";

export type EventStatus = "active" | "canceled" | "postponed";

export type SourceKind =
  | "luma_discover"
  | "luma_calendar"
  | "browser"
  | "api";

export type Tier = "dont_miss" | "strong" | "radar";

export interface PersonRef {
  name: string;
  bio?: string | null;
  person_id?: string | null;
}

export interface PersonLinks {
  linkedin?: string;
  crunchbase?: string;
  twitter?: string;
  website?: string;
}

export interface ResearchSource {
  url?: string;
  title?: string;
  snippet?: string;
}

/** A synthesized speaker/host profile (§11.3), stored in `people`. */
export interface PersonProfile {
  display_name: string;
  title?: string | null;
  company?: string | null;
  affiliations?: string[];
  links?: PersonLinks;
  bio?: string | null;
  prominence?: number | null; // 0–10
  note?: string | null; // one-line why-notable
}

/** The contract every source adapter returns (PRD §9.2). Times are UTC. */
export interface NormalizedEvent {
  source_event_id: string;
  title: string;
  url?: string | null;
  status: EventStatus;
  starts_at: Date; // UTC
  ends_at?: Date | null; // UTC
  region_id: string;
  venue_name?: string | null;
  address?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  description?: string | null;
  hosts?: PersonRef[];
  speakers?: PersonRef[];
  guest_count?: number | null;
  categories?: Category[];
  raw: unknown; // original payload, retained indefinitely
}

/** Structured scorer output (PRD §11.2). */
export interface ScoreResult {
  score: number; // 0.0–10.0
  tier: Tier;
  category_tag: Category | string;
  signals: {
    attendee_count?: number | null;
    attendee_quality?: number | null; // 0–10
    speaker_quality?: number | null; // 0–10
    event_type?: string;
    [k: string]: unknown;
  };
  tldr: string;
}

export interface PostSchedule {
  daily_hour?: number; // local hour, e.g. 7
  weekly_dow?: number; // 1=Mon … 7=Sun (ISO)
  weekly_hour?: number; // local hour, e.g. 18
}

export type DigestKind = "daily" | "weekly";
