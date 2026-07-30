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
import {
  LumaRateLimited,
  fetchLumaDetail,
  fetchLumaPageDescription,
  lumaSlugFromUrl,
  isPlaceholderTime,
  pool,
} from "./luma-detail";

const log = logger("luma-backfill");

export interface BackfillSummary {
  candidates: number;
  enriched: number;
  descriptionsFetched: number;
}

/** Below this, a description is a teaser ("… see more"), not event content. */
const THIN_DESCRIPTION = 400;
/** Page fetches are ~300KB each AND rate-limited (a 200-page burst got us 429s
 *  for everything after it), so they are deliberately slow and capped: soonest
 *  events first, the rest catch up on later daily runs. */
const MAX_DESCRIPTION_FETCHES = Number(process.env.LUMA_DESC_FETCH_LIMIT ?? 40);
const DESCRIPTION_CONCURRENCY = 2;
const DESCRIPTION_PAUSE_MS = 350;

export async function runLumaBackfill(opts?: {
  windowPastDays?: number;
  windowFutureDays?: number;
  concurrency?: number;
  descriptionLimit?: number;
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
          // …or the description is still the list endpoint's teaser, which is
          // what leaves the scorer judging an event on ~200 characters.
          isNull(schema.events.description),
          sql`length(${schema.events.description}) < ${THIN_DESCRIPTION}`,
        ),
      ),
    );

  const candidates = rows
    .map((r) => ({ row: r, slug: lumaSlugFromUrl(r.url) }))
    .filter((c): c is { row: (typeof rows)[number]; slug: string } => !!c.slug);

  // Soonest UPCOMING first. Sorting the whole set by date spends the fetch budget
  // on events that have already happened — the window reaches a day into the past
  // so late edits are picked up, and those rows were crowding out tomorrow's.
  candidates.sort((a, b) => a.row.startsAt.getTime() - b.row.startsAt.getTime());
  const upcoming = candidates.filter((c) => c.row.startsAt.getTime() >= now.getTime());

  // Full descriptions come from the event PAGE (the APIs only carry a teaser),
  // so they are fetched separately and budgeted.
  const descLimit = opts?.descriptionLimit ?? MAX_DESCRIPTION_FETCHES;
  const needDescription = upcoming
    .filter(({ row }) => (row.description?.length ?? 0) < THIN_DESCRIPTION)
    .slice(0, descLimit);
  const fullDescriptions = new Map<string, string>();
  let rateLimited = false;
  await pool(needDescription, DESCRIPTION_CONCURRENCY, async ({ row, slug }) => {
    if (rateLimited) return; // stop the batch rather than hammer a closed door
    try {
      const desc = await fetchLumaPageDescription(slug);
      if (desc && desc.length > (row.description?.length ?? 0)) {
        fullDescriptions.set(row.id, desc);
      }
    } catch (e) {
      if (e instanceof LumaRateLimited) {
        rateLimited = true;
        log.warn("lu.ma rate-limited; stopping description fetches for this run");
        return;
      }
      throw e;
    }
    await new Promise((r) => setTimeout(r, DESCRIPTION_PAUSE_MS));
  });

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

    const nextDescription = fullDescriptions.get(row.id) ?? row.description;

    const changed =
      nextDescription !== row.description ||
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
      description: nextDescription,
      guestCount: nextGuestCount,
      hosts: nextHosts,
      speakers: nextSpeakers,
    });

    await db
      .update(schema.events)
      .set({
        description: nextDescription,
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
    `luma-backfill: ${candidates.length} lu.ma candidates → ${enriched} enriched ` +
      `(${fullDescriptions.size} full descriptions fetched)`,
  );
  return {
    candidates: candidates.length,
    enriched,
    descriptionsFetched: fullDescriptions.size,
  };
}
