// content_hash for change detection → drives incremental scoring (PRD §11.4).
// Hash the *meaningful* normalized fields only, so cosmetic changes (date-format,
// day-of-week text) don't churn the hash (Appendix C "cosmetic-change filtering").
import { createHash } from "node:crypto";
import type { NormalizedEvent, PersonRef } from "@/types";

function names(refs: PersonRef[] | undefined): string[] {
  return (refs ?? [])
    .map((r) => (r?.name ?? "").trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

export function contentHash(e: {
  title: string;
  startsAt: Date;
  endsAt?: Date | null;
  status?: string | null;
  venueName?: string | null;
  city?: string | null;
  description?: string | null;
  guestCount?: number | null;
  hosts?: PersonRef[];
  speakers?: PersonRef[];
}): string {
  const payload = {
    title: e.title.trim().toLowerCase(),
    starts_at: e.startsAt.toISOString(), // canonical UTC instant, not display text
    ends_at: e.endsAt ? e.endsAt.toISOString() : null,
    status: e.status ?? "active",
    venue: (e.venueName ?? "").trim().toLowerCase(),
    city: (e.city ?? "").trim().toLowerCase(),
    // Description is truncated so tiny edits/typo fixes don't force a re-score,
    // but a substantive rewrite still does.
    description: (e.description ?? "").trim().toLowerCase().slice(0, 500),
    guest_count: e.guestCount ?? null,
    hosts: names(e.hosts),
    speakers: names(e.speakers),
  };
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32);
}

/** content_hash for a NormalizedEvent (ingest-time). */
export function contentHashForNormalized(e: NormalizedEvent): string {
  return contentHash({
    title: e.title,
    startsAt: e.starts_at,
    endsAt: e.ends_at ?? null,
    status: e.status,
    venueName: e.venue_name ?? null,
    city: e.city ?? null,
    description: e.description ?? null,
    guestCount: e.guest_count ?? null,
    hosts: e.hosts,
    speakers: e.speakers,
  });
}
