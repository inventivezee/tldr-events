// Ingestion runner (PRD §9). Runs enabled source adapters, normalizes to UTC,
// and upserts into `events` keyed by (source_id, source_event_id). Failure is
// isolated per source (§8 "fail partial, never total"). One browser session is
// shared across all browser sources + speaker research.
import { asc, eq, sql } from "drizzle-orm";
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
  error?: string;
}

export interface IngestSummary {
  total: number;
  results: SourceResult[];
}

export async function runIngestion(opts?: {
  sourceIds?: string[];
  excludeSourceIds?: string[];
  budgetMs?: number;
}): Promise<IngestSummary> {
  const db = getDb();
  const now = new Date();
  // Stop starting new sources past this soft deadline so the finally-block can
  // close the browser session before Vercel's maxDuration hard-kill.
  const deadline = Date.now() + (opts?.budgetMs ?? 270000);

  // Order by priority asc → the fast Luma backbone (priority 10–20) runs before
  // the slower browser scrapes, so a run that hits the function time limit still
  // persists the backbone (fail-partial at the function level).
  const allSources = await db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.enabled, true))
    .orderBy(asc(schema.sources.priority));

  let sources = opts?.sourceIds
    ? allSources.filter((s) => opts.sourceIds!.includes(s.id))
    : allSources;
  if (opts?.excludeSourceIds?.length) {
    sources = sources.filter((s) => !opts.excludeSourceIds!.includes(s.id));
  }

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
      if (Date.now() > deadline) {
        log.warn(`time budget reached; skipping ${source.id} (and any remaining)`);
        results.push({
          sourceId: source.id,
          ok: false,
          count: 0,
          upserted: 0,
          error: "skipped: time budget reached",
        });
        continue;
      }
      if (needsBrowser(source) && !session) {
        results.push({
          sourceId: source.id,
          ok: false,
          count: 0,
          upserted: 0,
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
          error: `no adapter for kind=${source.kind} id=${source.id}`,
        });
        continue;
      }
      try {
        const events = await adapter(source, ctx);
        const upserted = await upsertEvents(source, events);
        results.push({
          sourceId: source.id,
          ok: true,
          count: events.length,
          upserted,
        });
      } catch (e) {
        log.error(`source ${source.id} failed`, e);
        results.push({
          sourceId: source.id,
          ok: false,
          count: 0,
          upserted: 0,
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
): Promise<number> {
  if (events.length === 0) return 0;
  const db = getDb();

  const rows = events.map((e) => ({
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
    contentHash: contentHashForNormalized(e),
    raw: e.raw ?? null,
    lastSeenAt: new Date(),
  }));

  // Batch upsert (one statement per chunk) using excluded.* — updates only
  // source-derived columns, leaving canonical_group / is_primary (owned by dedup)
  // and first_seen_at untouched.
  const setClause = {
    title: sql`excluded.title`,
    titleNormalized: sql`excluded.title_normalized`,
    description: sql`excluded.description`,
    url: sql`excluded.url`,
    status: sql`excluded.status`,
    startsAt: sql`excluded.starts_at`,
    endsAt: sql`excluded.ends_at`,
    regionId: sql`excluded.region_id`,
    venueName: sql`excluded.venue_name`,
    venueNormalized: sql`excluded.venue_normalized`,
    address: sql`excluded.address`,
    city: sql`excluded.city`,
    lat: sql`excluded.lat`,
    lng: sql`excluded.lng`,
    hosts: sql`excluded.hosts`,
    speakers: sql`excluded.speakers`,
    guestCount: sql`excluded.guest_count`,
    categories: sql`excluded.categories`,
    contentHash: sql`excluded.content_hash`,
    raw: sql`excluded.raw`,
    lastSeenAt: sql`excluded.last_seen_at`,
  };

  const CHUNK = 100;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await db
      .insert(schema.events)
      .values(slice)
      .onConflictDoUpdate({
        target: [schema.events.sourceId, schema.events.sourceEventId],
        set: setClause,
      });
    upserted += slice.length;
  }
  return upserted;
}
