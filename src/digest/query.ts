// Read query shared by Telegram + Web: primary, active, in-region, in-window
// events whose feed score clears min_score, ordered by time then score.
// Relevance = score, not category (§11.5). Attaches notable researched people.
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { PersonRef, Tier } from "@/types";
import { resolvePeople } from "@/research/speakers";
import { normalizeName } from "@/lib/text";
import type { UtcWindow } from "@/lib/time";

export interface NotablePerson {
  name: string;
  note: string | null;
  prominence: number | null;
  title: string | null;
  company: string | null;
}

export interface DeliveryEvent {
  id: string;
  title: string;
  url: string | null;
  startsAt: Date;
  city: string | null;
  venueName: string | null;
  guestCount: number | null;
  score: number;
  tier: Tier;
  tldr: string | null;
  categoryTag: string | null;
  relevant: boolean;
  notable: NotablePerson[];
  speakerNames: string[]; // raw host/speaker names (for the 🎤 line)
}

const NOTABLE_MIN_PROMINENCE = 6;

const ROLE_WORDS =
  /\b(co-?founders?|founders?|ceo|cto|coo|cfo|cmo|gp|lp|vc|partner|head|director|lead|engineer|investor|president|chair(?:man|woman|person)?|organiz(?:er|ers)|host|manager|principal|advisor|angel|operator|scientist|researcher|of)\b/i;

/** Tidy a raw host/speaker name for display: drop a trailing role/affiliation
 *  clause ("Vanessa Larco - Co-founder at Premise" → "Vanessa Larco"; "Mercedes
 *  Bent, Cofounder Premise" → "Mercedes Bent"; "Emily, Workato" → "Emily") and
 *  strip stray trailing punctuation ("tokens&" → "tokens"). Leaves genuine
 *  hyphenated names intact (no spaces around the hyphen: "Rizel Bobb-Semple"). */
function cleanName(raw: string): string {
  let s = raw.trim();
  const m = s.match(/^(.{2,}?)(?:\s[-–—]\s|,\s|\s\()(.*)$/);
  if (m) {
    const [, head, tailRaw] = m;
    const tail = tailRaw.replace(/\)$/, "").trim();
    const tailWords = tail.split(/\s+/).filter(Boolean);
    // Drop the tail when it reads like a role/affiliation, contains " at ", or is
    // a short (≤2-word) trailing org/handle — the common Luma "Name, Org" shape.
    if (ROLE_WORDS.test(tail) || /\bat\b/i.test(tail) || tailWords.length <= 2) {
      s = head.trim();
    }
  }
  return s.replace(/[\s,&\-–—]+$/, "").trim();
}

export async function queryDeliveryEvents(params: {
  feedId: string;
  regionId: string;
  minScore: number;
  window: UtcWindow;
  categoryTag?: string;
  relevantOnly?: boolean;
  limit?: number;
}): Promise<DeliveryEvent[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      url: schema.events.url,
      startsAt: schema.events.startsAt,
      city: schema.events.city,
      venueName: schema.events.venueName,
      guestCount: schema.events.guestCount,
      hosts: schema.events.hosts,
      speakers: schema.events.speakers,
      score: schema.scores.score,
      tier: schema.scores.tier,
      tldr: schema.scores.tldr,
      categoryTag: schema.scores.categoryTag,
      relevant: schema.scores.relevant,
    })
    .from(schema.events)
    .innerJoin(
      schema.scores,
      and(
        eq(schema.scores.eventId, schema.events.id),
        eq(schema.scores.feedId, params.feedId),
      ),
    )
    .where(
      and(
        eq(schema.events.regionId, params.regionId),
        eq(schema.events.isPrimary, true),
        eq(schema.events.status, "active"),
        gte(schema.events.startsAt, params.window.start),
        lte(schema.events.startsAt, params.window.end),
        gte(schema.scores.score, String(params.minScore)),
        params.categoryTag
          ? eq(schema.scores.categoryTag, params.categoryTag)
          : sql`true`,
        params.relevantOnly ? eq(schema.scores.relevant, true) : sql`true`,
      ),
    )
    .orderBy(schema.events.startsAt, sql`${schema.scores.score} desc`);

  // Resolve notable people once across the result set.
  const allNames: string[] = [];
  for (const r of rows) {
    for (const p of [...((r.hosts ?? []) as PersonRef[]), ...((r.speakers ?? []) as PersonRef[])]) {
      if (p?.name) allNames.push(p.name);
    }
  }
  const profiles = await resolvePeople(allNames);

  const out: DeliveryEvent[] = rows.map((r) => {
    const refs = [
      ...((r.hosts ?? []) as PersonRef[]),
      ...((r.speakers ?? []) as PersonRef[]),
    ];
    const notable: NotablePerson[] = [];
    const seen = new Set<string>();
    for (const ref of refs) {
      const key = normalizeName(ref.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const prof = profiles.get(key);
      const prom = prof?.prominence != null ? Number(prof.prominence) : null;
      if (prof && prom != null && prom >= NOTABLE_MIN_PROMINENCE) {
        notable.push({
          name: prof.displayName || ref.name,
          note: prof.note,
          prominence: prom,
          title: prof.title,
          company: prof.company,
        });
      }
    }
    notable.sort((a, b) => (b.prominence ?? 0) - (a.prominence ?? 0));

    // Cleaned host/speaker display names (deduped) for the digest's 🎤 line.
    const speakerNames: string[] = [];
    const nameSeen = new Set<string>();
    for (const ref of refs) {
      const key = normalizeName(ref.name);
      if (!key || nameSeen.has(key)) continue;
      nameSeen.add(key);
      const display = cleanName(ref.name ?? "");
      if (display) speakerNames.push(display);
    }

    return {
      id: r.id,
      title: r.title,
      url: r.url,
      startsAt: r.startsAt,
      city: r.city,
      venueName: r.venueName,
      guestCount: r.guestCount,
      score: Number(r.score),
      tier: r.tier as Tier,
      tldr: r.tldr,
      categoryTag: r.categoryTag,
      relevant: r.relevant ?? true,
      notable: notable.slice(0, 3),
      speakerNames: speakerNames.slice(0, 4),
    };
  });

  return params.limit ? out.slice(0, params.limit) : out;
}
