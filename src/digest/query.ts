// Read query shared by Telegram + Web: primary, active, in-region, in-window
// events whose feed score clears min_score, ordered by time then score.
// Relevance = score, not category (§11.5). Attaches notable researched people.
import { and, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { PersonRef, Tier } from "@/types";
import { resolvePeople } from "@/research/speakers";
import { normalizeName } from "@/lib/text";
import { buildEventLinks, type EventLink } from "@/lib/event-links";
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
  endsAt: Date | null;
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
  /** Every distinct destination for this event (primary first). Usually one; a
   *  deduped cross-source event can have e.g. Luma + the host's own site. */
  links: EventLink[];
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
  // An em/en dash surrounded by spaces separates a name from whatever describes
  // it — a role, a company, or a talk title ("Elizabeth Fuentes — Strands Agents
  // pipeline talk"). Cut there unconditionally: the role-word test below can't
  // recognise a talk title, and no real name contains a spaced em dash.
  s = s.split(/\s[—–]\s/)[0].trim();
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
      endsAt: schema.events.endsAt,
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
      signals: schema.scores.signals,
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

  // Alternate source links: every row in the same canonical group (a primary's
  // canonical_group is its own id). One query for the whole result set.
  const linksByEvent = new Map<string, EventLink[]>();
  if (rows.length) {
    const members = await db
      .select({
        id: schema.events.id,
        url: schema.events.url,
        isPrimary: schema.events.isPrimary,
        canonicalGroup: schema.events.canonicalGroup,
      })
      .from(schema.events)
      .where(
        inArray(
          schema.events.canonicalGroup,
          rows.map((r) => r.id),
        ),
      );
    const byGroup = new Map<string, typeof members>();
    for (const m of members) {
      if (!m.canonicalGroup) continue;
      const arr = byGroup.get(m.canonicalGroup) ?? [];
      arr.push(m);
      byGroup.set(m.canonicalGroup, arr);
    }
    for (const [groupId, ms] of byGroup) linksByEvent.set(groupId, buildEventLinks(ms));
  }

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

    // Speakers the scorer read out of the event description. Platforms often
    // leave featured_guests empty while the write-up names the line-up in prose,
    // so these are the most reliable answer to "who is speaking".
    const signals = (r.signals ?? {}) as Record<string, unknown>;
    const billedSpeakers = Array.isArray(signals.key_speakers)
      ? (signals.key_speakers as unknown[])
          .filter((x): x is string => typeof x === "string" && x.trim().length > 1)
          .slice(0, 6)
      : [];

    // Names for the digest's 🎤 line — SPEAKERS FIRST.
    //
    // This used to walk hosts-then-speakers over one merged list and take the
    // first few, so a hosted event always showed its organisers: the OpenAI
    // Codex meetup listed "TatianaSF com, Natalie Pan, Funding Breakthrough Lab"
    // (all hosts) while ten actual speakers sat unused behind them. Who is
    // speaking is the reason to attend; the host is a fallback when nobody is
    // billed. LLM-extracted speakers (from the event description) outrank both,
    // since platforms often leave featured_guests empty.
    const speakerNames: string[] = [];
    const nameSeen = new Set<string>();
    const pushNames = (list: { name?: string | null }[]) => {
      for (const ref of list) {
        const display = cleanName(ref?.name ?? "");
        // Dedupe on the CLEANED name: "Anchit Jain — talk A" and "Anchit Jain —
        // talk B" are different raw strings but the same person, and both
        // rendered as "Anchit Jain" side by side.
        const key = normalizeName(display);
        if (!key || nameSeen.has(key)) continue;
        nameSeen.add(key);
        speakerNames.push(display);
      }
    };
    pushNames(billedSpeakers.map((name) => ({ name })));
    pushNames((r.speakers ?? []) as PersonRef[]);
    // Hosts only fill the gap when nobody is billed as speaking.
    if (speakerNames.length === 0) pushNames((r.hosts ?? []) as PersonRef[]);

    return {
      id: r.id,
      title: r.title,
      url: r.url,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
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
      // Fall back to the row's own URL if dedup hasn't grouped it yet.
      links:
        linksByEvent.get(r.id) ??
        buildEventLinks([{ id: r.id, url: r.url, isPrimary: true }]),
    };
  });

  return params.limit ? out.slice(0, params.limit) : out;
}
