// Ingestion runner (PRD §9). Runs enabled source adapters, normalizes to UTC,
// and upserts into `events` keyed by (source_id, source_event_id). Failure is
// isolated per source (§8 "fail partial, never total"). One browser session is
// shared across all browser sources + speaker research.
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { SourceRow } from "@/db/schema";
import type { NormalizedEvent } from "@/types";
import { adapterFor } from "./adapters";
import type { FetchContext } from "./types";
import { needsBrowser } from "./types";
import {
  createBrowserSession,
  browserConfigured,
  type BrowserSession,
} from "@/lib/browserbase";
import { normalizeText, normalizeVenue } from "@/lib/text";
import { contentHashForNormalized } from "@/lib/hash";
import { logger } from "@/lib/logger";

const log = logger("ingest");

export interface SourceResult {
  sourceId: string;
  ok: boolean;
  count: number;
  upserted: number;
  changed: number;
  error?: string;
}

export interface IngestSummary {
  total: number;
  results: SourceResult[];
}

export async function runIngestion(opts?: {
  sourceIds?: string[];
}): Promise<IngestSummary> {
  const db = getDb();
  const now = new Date();

  // Order by priority asc → the fast Luma backbone (priority 10–20) runs before
  // the slower browser scrapes, so a run that hits the function time limit still
  // persists the backbone (fail-partial at the function level).
  const allSources = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.enabled, true))
    .orderBy(asc(schema.sources.priority));

  const sources = opts?.sourceIds
    ? allSources.filter((s) => opts.sourceIds!.includes(s.id))
    : allSources;

  const anyBrowser = sources.some(needsBrowser);
  let session: BrowserSession | undefined;
  if (anyBrowser) {
    if (browserConfigured()) {
      try {
        session = await createBrowserSession();
      } catch (e) {
        log.error("failed to create browser session; skipping browser sources", e);
      }
    } else {
      log.warn("BROWSERBASE not configured; skipping browser sources this run");
    }
  }

  const ctx: FetchContext = { session, now };
  const results: SourceResult[] = [];

  try {
    for (const source of sources) {
      if (needsBrowser(source) && !session) {
        results.push({
          sourceId: source.id,
          ok: false,
          count: 0,
          upserted: 0,
          changed: 0,
          error: "browser session unavailable",
        });
        continue;
      }
      const adapter = adapterFor(source);
      if (!adapter) {
        results.push({
          sourceId: source.id,
          ok: false,
          count: 0,
          upserted: 0,
          changed: 0,
          error: `no adapter for kind=${source.kind} id=${source.id}`,
        });
        continue;
      }
      try {
        const events = await adapter(source, ctx);
        const { upserted, changed } = await upsertEvents(source, events);
        results.push({
          sourceId: source.id,
          ok: true,
          count: events.length,
          upserted,
          changed,
        });
      } catch (e) {
        log.error(`source ${source.id} failed`, e);
        results.push({
          sourceId: source.id,
          ok: false,
          count: 0,
          upserted: 0,
          changed: 0,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    if (session) await session.close();
  }

  const total = results.reduce((n, r) => n + r.upserted, 0);
  log.info(`ingestion complete: ${total} rows upserted across ${results.length} sources`);
  return { total, results };
}

async function upsertEvents(
  source: SourceRow,
  events: NormalizedEvent[],
): Promise<{ upserted: number; changed: number }> {
  const db = getDb();
  let upserted = 0;
  let changed = 0;

  for (const e of events) {
    const contentHash = contentHashForNormalized(e);
    const values = {
      sourceId: source.id,
      sourceEventId: e.source_event_id,
      title: e.title,
      titleNormalized: normalizeText(e.title),
      description: e.description ?? null,
      url: e.url ?? null,
      status: e.status,
      startsAt: e.starts_at,
      endsAt: e.ends_at ?? null,
      regionId: e.region_id,
      venueName: e.venue_name ?? null,
      venueNormalized: normalizeVenue(e.venue_name),
      address: e.address ?? null,
      city: e.city ?? null,
      lat: e.lat ?? null,
      lng: e.lng ?? null,
      hosts: e.hosts ?? [],
      speakers: e.speakers ?? [],
      guestCount: e.guest_count ?? null,
      categories: e.categories ?? [],
      contentHash,
      raw: e.raw ?? null,
      lastSeenAt: new Date(),
    };

    // Detect a content change so we can report re-score churn.
    const [existing] = await db
      .select({ contentHash: schema.events.contentHash })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.sourceId, source.id),
          eq(schema.events.sourceEventId, e.source_event_id),
        ),
      )
      .limit(1);

    if (!existing || existing.contentHash !== contentHash) changed++;

    await db
      .insert(schema.events)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.events.sourceId, schema.events.sourceEventId],
        // Update source-derived fields only; leave canonical_group / is_primary
        // (owned by dedup) and first_seen_at untouched.
        set: {
          title: values.title,
          titleNormalized: values.titleNormalized,
          description: values.description,
          url: values.url,
          status: values.status,
          startsAt: values.startsAt,
          endsAt: values.endsAt,
          regionId: values.regionId,
          venueName: values.venueName,
          venueNormalized: values.venueNormalized,
          address: values.address,
          city: values.city,
          lat: values.lat,
          lng: values.lng,
          hosts: values.hosts,
          speakers: values.speakers,
          guestCount: values.guestCount,
          categories: values.categories,
          contentHash: values.contentHash,
          raw: values.raw,
          lastSeenAt: values.lastSeenAt,
        },
      });
    upserted++;
  }

  return { upserted, changed };
}
