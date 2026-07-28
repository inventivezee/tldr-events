// Cross-source Luma backfill. Many Luma events reach us via Cerebral Valley /
// Google (which link to lu.ma) rather than the Luma list endpoint, so they never
// get attendance or the real host/guest list. This pass resolves any lu.ma URL
// to the Luma detail endpoint and fills guest_count / hosts / speakers, then
// recomputes content_hash so the incremental scorer re-scores the event.
//
// Runs after ingest, before dedup — so dedup's primary-enrichment and the scorer
// both see the real numbers.
import { and, gte, lte, or, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { PersonRef } from "@/types";
import { contentHash } from "@/lib/hash";
import { logger } from "@/lib/logger";
import { fetchLumaDetail, lumaSlugFromUrl, isPlaceholderTime, pool } from "./luma-detail";

const log = logger("luma-backfill");

export interface BackfillSummary {
  candidates: number;
  enriched: number;
}

export async function runLumaBackfill(opts?: {
  windowPastDays?: number;
  windowFutureDays?: number;
  concurrency?: number;
}): Promise<BackfillSummary> {
  const db = getDb();
  const now = new Date();
  const past = new Date(now.getTime() - (opts?.windowPastDays ?? 1) * 86400000);
  const future = new Date(
    now.getTime() + (opts?.windowFutureDays ?? 90) * 86400000,
  );

  // Events in-window still missing attendance (null or 0). We further filter to
  // lu.ma URLs in code (the slug parse). Gating on the count only — not on empty
  // hosts — avoids re-fetching events that genuinely have no host/guest list on
  // every run; the fetch still fills hosts/speakers when it does run.
  const rows = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      startsAt: schema.events.startsAt,
      endsAt: schema.events.endsAt,
      status: schema.events.status,
      venueName: schema.events.venueName,
      city: schema.events.city,
      description: schema.events.description,
      url: schema.events.url,
      guestCount: schema.events.guestCount,
      hosts: schema.events.hosts,
      speakers: schema.events.speakers,
    })
    .from(schema.events)
    .where(
      and(
        gte(schema.events.startsAt, past),
        lte(schema.events.startsAt, future),
        or(
          isNull(schema.events.guestCount),
          eq(schema.events.guestCount, 0),
          // …or the time looks like a date-only placeholder (midnight in UTC or
          // in the region's zone), which the detail endpoint can replace with the
          // real start. A UTC-midnight placeholder is the important case: it
          // reads as 5pm the PREVIOUS day locally, i.e. the wrong day.
          sql`date_trunc('minute', ${schema.events.startsAt} at time zone 'UTC') = date_trunc('day', ${schema.events.startsAt} at time zone 'UTC')`,
          sql`date_trunc('minute', ${schema.events.startsAt} at time zone 'America/Los_Angeles') = date_trunc('day', ${schema.events.startsAt} at time zone 'America/Los_Angeles')`,
        ),
      ),
    );

  const candidates = rows
    .map((r) => ({ row: r, slug: lumaSlugFromUrl(r.url) }))
    .filter((c): c is { row: (typeof rows)[number]; slug: string } => !!c.slug);

  let enriched = 0;
  await pool(candidates, opts?.concurrency ?? 5, async ({ row, slug }) => {
    const detail = await fetchLumaDetail(slug);
    if (!detail) return;

    const hosts = (row.hosts ?? []) as PersonRef[];
    const speakers = (row.speakers ?? []) as PersonRef[];
    const nextGuestCount =
      detail.guestCount != null && detail.guestCount > (row.guestCount ?? 0)
        ? detail.guestCount
        : row.guestCount;
    const nextHosts = hosts.length ? hosts : detail.hosts;
    const nextSpeakers = speakers.length ? speakers : detail.speakers;

    // Replace a date-only placeholder with Luma's real start. Only when the
    // stored value is a placeholder — a published time is never second-guessed.
    const timeIsPlaceholder = isPlaceholderTime(row.startsAt);
    const nextStartsAt =
      timeIsPlaceholder && detail.startsAt ? detail.startsAt : row.startsAt;
    const nextEndsAt =
      timeIsPlaceholder && detail.startsAt ? (detail.endsAt ?? row.endsAt) : row.endsAt;

    const changed =
      nextGuestCount !== row.guestCount ||
      nextHosts !== hosts ||
      nextSpeakers !== speakers ||
      nextStartsAt.getTime() !== row.startsAt.getTime();
    if (!changed) return;

    // Recompute content_hash from the (post-enrichment) meaningful fields so the
    // incremental scorer treats this as a real change and re-scores it.
    const nextHash = contentHash({
      title: row.title,
      startsAt: nextStartsAt,
      endsAt: nextEndsAt,
      status: row.status,
      venueName: row.venueName,
      city: row.city,
      description: row.description,
      guestCount: nextGuestCount,
      hosts: nextHosts,
      speakers: nextSpeakers,
    });

    await db
      .update(schema.events)
      .set({
        startsAt: nextStartsAt,
        endsAt: nextEndsAt,
        guestCount: nextGuestCount,
        hosts: nextHosts,
        speakers: nextSpeakers,
        contentHash: nextHash,
      })
      .where(eq(schema.events.id, row.id));
    enriched++;
  });

  log.info(
    `luma-backfill: ${candidates.length} lu.ma candidates → ${enriched} enriched`,
  );
  return { candidates: candidates.length, enriched };
}
