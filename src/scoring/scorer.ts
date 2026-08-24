// Editorial scorer (PRD §11.2, §11.4, §11.5). For each enabled feed, score EVERY
// primary active event in the feed's region within the forward window — relevance
// is the SCORE, not a category gate. Incremental: only (event,feed) pairs with no
// score row or a changed content_hash / rubric_version are (re)scored. QUALITY
// score only (profile-agnostic). Uses researched people signals; TL;DR names names.
import { and, eq, gte, lte } from "drizzle-orm";
import { getDb, schema, sqlClient } from "@/db/client";
import type { EventRow, FeedRow } from "@/db/schema";
import type { PersonRef, ScoreResult } from "@/types";
import { forwardWindow, fmtLocalDateTime } from "@/lib/time";
import {
  resolveModel,
  structuredCall,
  llmConfigured,
  resetUsage,
  usage,
  type ToolDef,
} from "@/lib/llm";
import { resolvePeople } from "@/research/speakers";
import { heuristicScore } from "./heuristic";
import { tierFromScore } from "./tiers";
import { normalizeName } from "@/lib/text";
import { logger } from "@/lib/logger";

const log = logger("scorer");
// Per-run cap, sized so one invocation stays well inside the function timeout.
// Throughput comes from the pipeline re-running this stage until the queue is
// empty (see cron/pipeline.ts), not from a large batch.
const DEFAULT_BATCH = 40;

const SCORE_TOOL: ToolDef = {
  name: "record_score",
  description:
    "Record the editorial QUALITY score for this single event against the rubric. Score is profile-agnostic: how good is the event, period. Base every judgment ONLY on the provided event data and researched people; never invent facts or people.",
  input_schema: {
    type: "object",
    properties: {
      score: { type: "number", description: "0.0–10.0 quality score (one decimal)." },
      category_tag: {
        type: "string",
        enum: ["ai", "longevity", "fintech_blockchain", "hackathon", "founder_investor"],
        description: "Single best niche for display.",
      },
      industry_relevant: {
        type: "boolean",
        description:
          "True if the event is connected to the startup/founder/investor/tech world at all (including builder communities like Beta University, YC/Startup School) — even a low-quality relevant event is true. False ONLY for pure social/consumer/hobby events (bar crawls, film nights, run clubs).",
      },
      tldr: {
        type: "string",
        description:
          "One specific sentence that earns the click; name names when justified by the researched signals. ≤240 chars.",
      },
      signals: {
        type: "object",
        properties: {
          attendee_count: { type: "number" },
          attendee_quality: { type: "number", description: "0–10" },
          speaker_quality: {
            type: "number",
            description:
              "0–10: how notable/senior the people SPEAKING are (not the organisers). 0 when nobody is billed.",
          },
          host_quality: {
            type: "number",
            description:
              "0–10: how reputable the ORGANISER is, using the track record supplied under HOST TRACK RECORD plus any recognisable brand. 0 when unknown.",
          },
          key_speakers: {
            type: "array",
            items: { type: "string" },
            description:
              "Up to 5 people BILLED TO SPEAK/present/panel at this event, read from the description or the speaker list — 'Name — Title, Company' where stated. Organisers/hosts do NOT belong here unless they are also billed as speaking. Empty when nobody is billed. Never invent names.",
          },
          event_type: { type: "string" },
        },
      },
    },
    required: ["score", "category_tag", "industry_relevant", "tldr", "signals"],
  },
};

export interface ScoreSummary {
  skipped?: string;
  feedId: string;
  /** The model this run actually called. */
  model?: string;
  candidates: number;
  /** How many of the candidates needed (re)scoring this run. */
  needed?: number;
  scored: number;
  /** Events whose scoring call threw. Non-zero here with scored=0 means the
   *  provider is unreachable/misconfigured, NOT that there was nothing to do. */
  failed?: number;
  /** First failure's message, so the cause is visible without log diving. */
  error?: string;
  tokens: { input: number; output: number };
}

export async function runScorer(opts?: {
  feedId?: string;
  batch?: number;
}): Promise<ScoreSummary[]> {
  const db = getDb();
  const feeds = await db
    .select()
    .from(schema.feeds)
    .where(eq(schema.feeds.enabled, true));
  const targets = opts?.feedId ? feeds.filter((f) => f.id === opts.feedId) : feeds;

  const out: ScoreSummary[] = [];
  for (const feed of targets) {
    out.push(await scoreFeed(feed, opts?.batch));
  }
  return out;
}

async function scoreFeed(feed: FeedRow, batchArg?: number): Promise<ScoreSummary> {
  const db = getDb();
  const batch = batchArg ?? Number(process.env.SCORE_BATCH ?? DEFAULT_BATCH);

  if (!llmConfigured()) {
    return {
      skipped: "llm not configured",
      feedId: feed.id,
      candidates: 0,
      scored: 0,
      tokens: { input: 0, output: 0 },
    };
  }

  const activeModel = resolveModel(feed.model, process.env.SCORING_MODEL, "scoring");
  const now = new Date();
  const tz = await regionTz(feed.regionId ?? "sf_bay");
  const { start, end } = forwardWindow(now, tz, 21);

  // Candidate set: every PRIMARY ACTIVE event in the feed's region + window.
  const candidates = await db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.regionId, feed.regionId ?? "sf_bay"),
        eq(schema.events.isPrimary, true),
        eq(schema.events.status, "active"),
        gte(schema.events.startsAt, start),
        lte(schema.events.startsAt, end),
      ),
    );

  // Existing scores for this feed → decide what needs (re)scoring (§11.4).
  const existing = await db
    .select()
    .from(schema.scores)
    .where(eq(schema.scores.feedId, feed.id));
  const scoreByEvent = new Map(existing.map((s) => [s.eventId, s]));

  const needScore = candidates.filter((e) => {
    const s = scoreByEvent.get(e.id);
    if (!s) return true;
    if (s.contentHash !== e.contentHash) return true;
    if ((s.rubricVersion ?? 0) !== (feed.rubricVersion ?? 1)) return true;
    // A change of model is a change of judgment. Leaving old scores in place
    // ranks events the new model has never seen against ones it has, which is
    // not a ranking at all — it's two editors' opinions sorted into one list.
    // Bounded by the batch size and DAILY_SCORE_CAP, and the old score stays
    // visible until its replacement is written, so the board never empties.
    if (s.model && s.model !== activeModel) return true;
    return false;
  });

  // Prioritize the most promising events first (heuristic) within the batch.
  needScore.sort((a, b) => heuristicScore(b) - heuristicScore(a));
  const work = needScore.slice(0, batch);

  // One aggregate for the whole run, not a query per event.
  const hostStats = await hostTrackRecords(feed.id);

  resetUsage();
  let scored = 0;
  let failed = 0;
  let firstError: string | undefined;
  // Score with bounded concurrency — the editorial calls are independent, so a
  // small pool cuts wall-clock (a full re-score of a 300+ event window) without
  // risking API rate limits. Each event's write follows its own score.
  const CONCURRENCY = Number(process.env.SCORE_CONCURRENCY ?? 4);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, work.length) }, async () => {
      while (next < work.length) {
        const e = work[next++];
        try {
          const result = await scoreEvent(feed, e, tz, hostStats);
          await writeScore(feed, e, result);
          scored++;
        } catch (err) {
          failed++;
          // A per-event catch keeps one bad event from killing the batch, but it
          // also hid a total outage: after the provider switch every call threw
          // and the run still reported `scored: 0` with a 200, which reads as
          // "nothing to do". Keep the first message so the summary can say so.
          firstError ??= err instanceof Error ? err.message : String(err);
          log.warn(`score failed for event ${e.id} (${e.title})`, err);
        }
      }
    }),
  );

  const tok = usage();
  log.info(
    `scorer[${feed.id}]: scored ${scored}/${needScore.length} needing (of ${candidates.length} candidates), ${failed} failed; tokens in=${tok.input} out=${tok.output}`,
  );
  if (failed && !scored) {
    log.error(`scorer[${feed.id}]: EVERY scoring call failed — ${firstError}`);
  }
  return {
    feedId: feed.id,
    model: activeModel,
    candidates: candidates.length,
    needed: needScore.length,
    scored,
    ...(failed ? { failed, error: firstError } : {}),
    tokens: tok,
  };
}

export interface HostRecord {
  events: number;
  avgAttendance: number | null;
  avgScore: number | null;
}

/**
 * Track record per host, from our own history: how often they appear as an
 * organiser, and how well their events draw.
 *
 * Attendance is the load-bearing figure — it is observed from the platforms, so
 * it says "people actually turn up to this organiser's events" without any
 * circularity. The average prior score is included but flagged in the prompt as
 * our own earlier opinion, because feeding a model its own past judgments will
 * happily ratchet a host upward forever if it's treated as independent evidence.
 * Only organisers with a real history (>= MIN_HOST_EVENTS) are reported at all.
 */
const MIN_HOST_EVENTS = 3;

export async function hostTrackRecords(feedId: string): Promise<Map<string, HostRecord>> {
  const rows = await sqlClient()`
    select lower(btrim(h->>'name')) as host,
           count(*)::int                      as events,
           round(avg(nullif(e.guest_count, 0)))::int as avg_attendance,
           round(avg(s.score), 1)::float      as avg_score
    from events e
    join scores s on s.event_id = e.id and s.feed_id = ${feedId}
    cross join lateral jsonb_array_elements(coalesce(e.hosts, '[]'::jsonb)) h
    where e.is_primary and coalesce(btrim(h->>'name'), '') <> ''
    group by 1
    having count(*) >= ${MIN_HOST_EVENTS}
  `;
  const out = new Map<string, HostRecord>();
  for (const r of rows as unknown as {
    host: string;
    events: number;
    avg_attendance: number | null;
    avg_score: number | null;
  }[]) {
    out.set(normalizeName(r.host), {
      events: r.events,
      avgAttendance: r.avg_attendance,
      avgScore: r.avg_score,
    });
  }
  return out;
}

/** A researched-or-raw person, ready to describe to the scorer. */
export interface ScoringPerson {
  name: string;
  role: "host" | "speaker";
  title?: string | null;
  company?: string | null;
  note?: string | null;
  prominence?: number | null;
}

/** DB-free scoring input, so the eval harness (Milestone 0) can reuse the core. */
export interface ScoringInput {
  rubric: string;
  model: string;
  title: string;
  startsAt: Date;
  tz?: string;
  city?: string | null;
  venueName?: string | null;
  guestCount?: number | null;
  categories?: string[];
  url?: string | null;
  description?: string | null;
  people: ScoringPerson[];
  /** Pre-rendered "Name — N events, avg attendance X, avg prior score Y" lines. */
  hostRecords?: string[];
}

/** The editorial scoring core — pure over its input, no DB access. */
export async function scoreWithRubric(input: ScoringInput): Promise<ScoreResult> {
  const prompt = buildPromptFromInput(input);
  return structuredCall<ScoreResult>({
    model: input.model,
    system: input.rubric,
    user: prompt,
    tool: SCORE_TOOL,
    maxTokens: 900,
  });
}

async function scoreEvent(
  feed: FeedRow,
  e: EventRow,
  tz: string,
  hostStats?: Map<string, HostRecord>,
): Promise<ScoreResult> {
  const speakers = (e.speakers ?? []) as PersonRef[];
  const hosts = (e.hosts ?? []) as PersonRef[];
  const names = [...hosts, ...speakers].map((p) => p.name).filter(Boolean);
  const profiles = await resolvePeople(names);

  const people: ScoringPerson[] = [
    ...hosts.map((h) => toScoringPerson(h, "host", profiles)),
    ...speakers.map((s) => toScoringPerson(s, "speaker", profiles)),
  ];

  const hostRecords = hosts
    .map((h) => {
      const rec = hostStats?.get(normalizeName(h.name ?? ""));
      if (!rec) return null;
      const bits = [`${rec.events} events in our history`];
      if (rec.avgAttendance) bits.push(`avg attendance ${rec.avgAttendance}`);
      if (rec.avgScore != null) bits.push(`avg prior score ${rec.avgScore}`);
      return `${h.name} — ${bits.join(", ")}`;
    })
    .filter((x): x is string => !!x);

  return scoreWithRubric({
    rubric: feed.scoringRubric,
    model: resolveModel(feed.model, process.env.SCORING_MODEL, "scoring"),
    title: e.title,
    startsAt: e.startsAt,
    tz,
    city: e.city,
    venueName: e.venueName,
    guestCount: e.guestCount,
    categories: e.categories ?? [],
    url: e.url,
    description: e.description,
    people,
    hostRecords,
  });
}

function toScoringPerson(
  p: PersonRef,
  role: "host" | "speaker",
  profiles: Map<string, typeof schema.people.$inferSelect>,
): ScoringPerson {
  const prof = profiles.get(normalizeName(p.name));
  return {
    name: p.name,
    role,
    title: prof?.title ?? null,
    company: prof?.company ?? null,
    note: prof?.note ?? null,
    prominence: prof?.prominence != null ? Number(prof.prominence) : null,
  };
}

function buildPromptFromInput(input: ScoringInput): string {
  const tz = input.tz ?? "America/Los_Angeles";
  const lines: string[] = [];
  lines.push(`TITLE: ${input.title}`);
  lines.push(`WHEN: ${fmtLocalDateTime(input.startsAt, tz)} (${tz})`);
  if (input.city) lines.push(`CITY: ${input.city}`);
  if (input.venueName) lines.push(`VENUE: ${input.venueName}`);
  if (input.guestCount != null) lines.push(`GUEST COUNT: ${input.guestCount}`);
  if ((input.categories ?? []).length)
    lines.push(`INGEST TAGS (hints): ${(input.categories ?? []).join(", ")}`);
  if (input.url) lines.push(`URL: ${input.url}`);
  if (input.description) lines.push(`DESCRIPTION: ${input.description.slice(0, 1500)}`);

  const describe = (p: ScoringPerson): string => {
    if (p.note || p.prominence != null) {
      const prom = p.prominence != null ? ` [prominence ${p.prominence}/10]` : "";
      const note = p.note ? ` — ${p.note}` : "";
      const co = p.company ? ` (${p.title ? p.title + ", " : ""}${p.company})` : "";
      return `  • ${p.name}${co}${note}${prom}`;
    }
    return `  • ${p.name} (${p.role}; not researched / unknown)`;
  };
  const hosts = input.people.filter((p) => p.role === "host");
  const speakers = input.people.filter((p) => p.role === "speaker");
  if (speakers.length) {
    lines.push("BILLED SPEAKERS / FEATURED GUESTS (with researched signals where available):");
    for (const s of speakers) lines.push(describe(s));
  }
  if (hosts.length) {
    lines.push("HOSTS / ORGANISERS (these run the event; they are NOT the speakers unless the description also bills them as speaking):");
    for (const h of hosts) lines.push(describe(h));
  }
  if (input.hostRecords?.length) {
    lines.push(
      "HOST TRACK RECORD (from our own history — attendance is observed from the platforms; the prior score is our own earlier rating, so treat it as weak evidence, not independent proof):",
    );
    for (const h of input.hostRecords) lines.push(`  • ${h}`);
  }
  if (!hosts.length && !speakers.length) {
    lines.push(
      "NAMED PEOPLE: none surfaced — this is normal and common. Judge the event on its relevance, format, topic, host reputation and scale; do NOT lower the score just because the room is unknown.",
    );
  }

  lines.push(
    "\nScore this event's QUALITY for the feed's founder/investor audience using the rubric. The score is driven by relevance, format, topic importance and apparent quality/scale/host.",
  );
  lines.push(
    "Read the DESCRIPTION for a billed line-up — organisers frequently list speakers in prose ('Invited Speaker: 1) …', 'Featuring …', 'Fireside with …') while the structured guest list stays empty or holds unrelated attendees. Put whoever is billed to speak into signals.key_speakers, and judge signals.speaker_quality on THOSE people, not on the organisers.",
  );
  lines.push(
    "Weight who is SPEAKING well above who is HOSTING: a genuinely notable speaker is a strong lift, while a reputable organiser is a mild one. Neither may cap or lower the score when unknown — that is the normal case.",
  );
  return lines.join("\n");
}

async function writeScore(feed: FeedRow, e: EventRow, r: ScoreResult): Promise<void> {
  const db = getDb();
  const score = clamp(Number(r.score), 0, 10);
  const tier = tierFromScore(score);
  await db
    .insert(schema.scores)
    .values({
      eventId: e.id,
      feedId: feed.id,
      score: score.toFixed(1),
      tier,
      categoryTag: r.category_tag ?? null,
      relevant: r.industry_relevant !== false, // default to relevant when unsure
      tldr: r.tldr ?? null,
      signals: r.signals ?? {},
      model: resolveModel(feed.model, process.env.SCORING_MODEL, "scoring"),
      rubricVersion: feed.rubricVersion ?? 1,
      contentHash: e.contentHash,
      scoredAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.scores.eventId, schema.scores.feedId],
      set: {
        score: score.toFixed(1),
        tier,
        categoryTag: r.category_tag ?? null,
        relevant: r.industry_relevant !== false,
        tldr: r.tldr ?? null,
        signals: r.signals ?? {},
        model: resolveModel(feed.model, process.env.SCORING_MODEL, "scoring"),
        rubricVersion: feed.rubricVersion ?? 1,
        contentHash: e.contentHash,
        scoredAt: new Date(),
      },
    });
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

async function regionTz(regionId: string): Promise<string> {
  const db = getDb();
  const [r] = await db
    .select({ tz: schema.regions.timezone })
    .from(schema.regions)
    .where(eq(schema.regions.id, regionId))
    .limit(1);
  return r?.tz ?? "America/Los_Angeles";
}
