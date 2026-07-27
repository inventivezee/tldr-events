// Deduplication & canonicalization (PRD §10). Two identity levels + multi-signal
// match: Stage 1 deterministic key (title|local-date|city), Stage 2 fuzzy fallback
// (same date + nearby venue + title token-set ≥ ~90). Within a group, the lowest
// -priority (most authoritative) source row is the enriched `is_primary`.
import { and, gte, lte, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { PersonRef } from "@/types";
import { startLocalDate } from "@/lib/time";
import {
  normalizeText,
  normalizeVenue,
  tokenSetRatio,
  haversineMeters,
} from "@/lib/text";
import { urlKeyOf } from "@/lib/event-links";
import { logger } from "@/lib/logger";

const log = logger("dedup");
const FUZZY_THRESHOLD = 90;
const VENUE_METERS = 200;

interface Row {
  id: string;
  sourceId: string | null;
  priority: number;
  title: string;
  titleNormalized: string;
  description: string | null;
  status: string;
  startsAt: Date;
  endsAt: Date | null;
  city: string | null;
  venueNormalized: string | null;
  venueName: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  hosts: PersonRef[];
  speakers: PersonRef[];
  guestCount: number | null;
  lastSeenAt: Date | null;
  tz: string;
  url: string | null;
  urlKey: string;
  canonicalKey: string;
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // path compression
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface DedupSummary {
  events: number;
  groups: number;
  primaries: number;
}

export async function runDedup(opts?: {
  windowPastDays?: number;
  windowFutureDays?: number;
}): Promise<DedupSummary> {
  const db = getDb();
  const now = new Date();
  const past = new Date(now.getTime() - (opts?.windowPastDays ?? 2) * 86400000);
  const future = new Date(
    now.getTime() + (opts?.windowFutureDays ?? 90) * 86400000,
  );

  const regions = await db.select().from(schema.regions);
  const tzById = new Map(regions.map((r) => [r.id, r.timezone]));

  const sources = await db.select().from(schema.sources);
  const priorityById = new Map(sources.map((s) => [s.id, s.priority ?? 100]));

  const raw = await db
    .select()
    .from(schema.events)
    .where(
      and(gte(schema.events.startsAt, past), lte(schema.events.startsAt, future)),
    );

  const rows: Row[] = raw.map((e) => {
    const tz = tzById.get(e.regionId ?? "") ?? "America/Los_Angeles";
    const cityNorm = normalizeText(e.city);
    const canonicalKey = `${e.titleNormalized}|${startLocalDate(e.startsAt, tz)}|${cityNorm}`;
    return {
      id: e.id,
      sourceId: e.sourceId,
      priority: e.sourceId ? (priorityById.get(e.sourceId) ?? 100) : 100,
      title: e.title,
      titleNormalized: e.titleNormalized,
      description: e.description,
      status: e.status ?? "active",
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      city: e.city,
      venueNormalized: e.venueNormalized,
      venueName: e.venueName,
      address: e.address,
      lat: e.lat,
      lng: e.lng,
      hosts: (e.hosts ?? []) as PersonRef[],
      speakers: (e.speakers ?? []) as PersonRef[],
      guestCount: e.guestCount,
      lastSeenAt: e.lastSeenAt,
      tz,
      url: e.url,
      urlKey: urlKeyOf(e.url),
      canonicalKey,
    };
  });

  const uf = new UnionFind();
  for (const r of rows) uf.find(r.id);

  // Stage 0 — same event URL across sources (e.g. Cerebral Valley / Google
  // linking to a Luma event). A shared event page = definitely one event.
  const byUrl = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.urlKey) continue;
    const arr = byUrl.get(r.urlKey) ?? [];
    arr.push(r);
    byUrl.set(r.urlKey, arr);
  }
  for (const arr of byUrl.values()) {
    for (let i = 1; i < arr.length; i++) uf.union(arr[0].id, arr[i].id);
  }

  // Stage 1 — deterministic key.
  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = byKey.get(r.canonicalKey) ?? [];
    arr.push(r);
    byKey.set(r.canonicalKey, arr);
  }
  for (const arr of byKey.values()) {
    for (let i = 1; i < arr.length; i++) uf.union(arr[0].id, arr[i].id);
  }

  // Stage 2 — fuzzy fallback within same local date.
  const byDate = new Map<string, Row[]>();
  for (const r of rows) {
    const d = startLocalDate(r.startsAt, r.tz);
    const arr = byDate.get(d) ?? [];
    arr.push(r);
    byDate.set(d, arr);
  }
  for (const arr of byDate.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        if (uf.find(a.id) === uf.find(b.id)) continue;
        if (!venueNearby(a, b)) continue;
        if (tokenSetRatio(a.title, b.title) >= FUZZY_THRESHOLD) {
          uf.union(a.id, b.id);
        }
      }
    }
  }

  // Assemble components.
  const components = new Map<string, Row[]>();
  for (const r of rows) {
    const root = uf.find(r.id);
    const arr = components.get(root) ?? [];
    arr.push(r);
    components.set(root, arr);
  }

  // Build the full write set first, then apply with bounded concurrency. The
  // previous sequential per-row await took >120s for ~500 rows over the pooler;
  // this cron now also runs the Luma backfill before dedup within the same 300s
  // budget, so pipelining the writes keeps it well clear of the timeout.
  const writes: Array<() => Promise<void>> = [];
  let primaries = 0;
  for (const members of components.values()) {
    // Primary = lowest priority (most authoritative); tie-break longest desc,
    // then event id so selection (and the resulting content_hash) is deterministic.
    members.sort(
      (a, b) =>
        a.priority - b.priority ||
        (b.description?.length ?? 0) - (a.description?.length ?? 0) ||
        a.id.localeCompare(b.id),
    );
    const primary = members[0];
    const groupId = primary.id;
    const enriched = enrichPrimary(primary, members);

    for (const m of members) {
      const id = m.id;
      if (id === primary.id) {
        primaries++;
        writes.push(() =>
          db
            .update(schema.events)
            .set({
              canonicalKey: m.canonicalKey,
              canonicalGroup: groupId,
              isPrimary: true,
              description: enriched.description,
              guestCount: enriched.guestCount,
              speakers: enriched.speakers,
              hosts: enriched.hosts,
              venueName: enriched.venueName,
              address: enriched.address,
              city: enriched.city,
              lat: enriched.lat,
              lng: enriched.lng,
              status: enriched.status,
              // NOTE: content_hash is intentionally NOT written here. It is owned
              // solely by ingestion (derived from the source row), so it stays a
              // stable incremental-scoring key and isn't churned by re-enrichment.
            })
            .where(inArray(schema.events.id, [id]))
            .then(() => undefined),
        );
      } else {
        writes.push(() =>
          db
            .update(schema.events)
            .set({
              canonicalKey: m.canonicalKey,
              canonicalGroup: groupId,
              isPrimary: false,
            })
            .where(inArray(schema.events.id, [id]))
            .then(() => undefined),
        );
      }
    }
  }

  // Bounded-concurrency writer: independent single-row updates, order-agnostic.
  const CONCURRENCY = 8;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, writes.length) }, async () => {
      while (next < writes.length) {
        const idx = next++;
        await writes[idx]();
      }
    }),
  );

  log.info(
    `dedup: ${rows.length} events → ${components.size} groups (${primaries} primaries)`,
  );
  return { events: rows.length, groups: components.size, primaries };
}

function venueNearby(a: Row, b: Row): boolean {
  const va = normalizeVenue(a.venueName ?? a.venueNormalized ?? "");
  const vb = normalizeVenue(b.venueName ?? b.venueNormalized ?? "");
  const haveCoords =
    a.lat != null && a.lng != null && b.lat != null && b.lng != null;
  const geoClose =
    haveCoords && haversineMeters(a.lat!, a.lng!, b.lat!, b.lng!) <= VENUE_METERS;

  // Both venues named: same name OR provably-close coords. Two DIFFERENT named
  // venues in the same city are NOT "nearby" (avoids merging distinct events).
  if (va && vb) return va === vb || geoClose;
  // A venue name is missing: trust coordinates when we have them.
  if (haveCoords) return geoClose;
  // No venue names and no coords: fall back to same city (last resort; the
  // title match must still clear the fuzzy threshold to actually merge).
  // Sources describe the same place at different granularity ("Berkeley" vs
  // "UC Berkeley Campus"), so accept one city string containing the other.
  const ca = normalizeText(a.city);
  const cb = normalizeText(b.city);
  return !!(ca && cb && cityMatches(ca, cb));
}

/** Same city, tolerant of granularity: equal, or one token set inside the other. */
function cityMatches(ca: string, cb: string): boolean {
  if (ca === cb) return true;
  const ta = new Set(ca.split(" ").filter(Boolean));
  const tb = new Set(cb.split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return false;
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!large.has(t)) return false;
  return true;
}

function enrichPrimary(primary: Row, members: Row[]) {
  // Longest description across members.
  let description = primary.description;
  for (const m of members) {
    if ((m.description?.length ?? 0) > (description?.length ?? 0)) {
      description = m.description;
    }
  }
  // Max guest count.
  const guestCount = members.reduce<number | null>(
    (max, m) =>
      m.guestCount != null ? Math.max(max ?? 0, m.guestCount) : max,
    primary.guestCount,
  );
  // Union speakers / hosts by normalized name.
  const speakers = unionPeople(members.flatMap((m) => m.speakers));
  const hosts = unionPeople(members.flatMap((m) => m.hosts));
  // Most specific venue/address/coords (prefer primary, else first available).
  const venueName = firstNonEmpty(primary.venueName, members.map((m) => m.venueName));
  const address = firstNonEmpty(primary.address, members.map((m) => m.address));
  const city = firstNonEmpty(primary.city, members.map((m) => m.city));
  const coordMember =
    primary.lat != null && primary.lng != null
      ? primary
      : members.find((m) => m.lat != null && m.lng != null);
  const lat = coordMember?.lat ?? null;
  const lng = coordMember?.lng ?? null;
  // Status follows the most recently seen member.
  const latest = [...members].sort(
    (a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0),
  )[0];
  const status = latest?.status ?? primary.status;

  return {
    description,
    guestCount,
    speakers,
    hosts,
    venueName,
    address,
    city,
    lat,
    lng,
    status,
  };
}

function unionPeople(refs: PersonRef[]): PersonRef[] {
  const out: PersonRef[] = [];
  const seen = new Set<string>();
  for (const r of refs) {
    if (!r?.name) continue;
    const key = normalizeText(r.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: r.name.trim(), bio: r.bio ?? null });
  }
  return out;
}

function firstNonEmpty(
  preferred: string | null,
  rest: (string | null)[],
): string | null {
  if (preferred && preferred.trim()) return preferred;
  for (const v of rest) if (v && v.trim()) return v;
  return null;
}
