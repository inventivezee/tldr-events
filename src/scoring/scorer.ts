// Editorial scorer (PRD §11.2, §11.4, §11.5). For each enabled feed, score EVERY
// primary active event in the feed's region within the forward window — relevance
// is the SCORE, not a category gate. Incremental: only (event,feed) pairs with no
// score row or a changed content_hash / rubric_version are (re)scored. QUALITY
// score only (profile-agnostic). Uses researched people signals; TL;DR names names.
import { and, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { EventRow, FeedRow } from "@/db/schema";
import type { PersonRef, ScoreResult } from "@/types";
import { forwardWindow, fmtLocalDateTime } from "@/lib/time";
import { structuredCall, llmConfigured, resetUsage, usage, type ToolDef } from "@/lib/llm";
import { resolvePeople } from "@/research/speakers";
import { heuristicScore } from "./heuristic";
import { tierFromScore } from "./tiers";
import { normalizeName } from "@/lib/text";
import { logger } from "@/lib/logger";

const log = logger("scorer");
const DEFAULT_BATCH = 25;

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
          speaker_quality: { type: "number", description: "0–10" },
          event_type: { type: "string" },
        },
      },
    },
    required: ["score", "category_tag", "tldr", "signals"],
  },
};

export interface ScoreSummary {
  skipped?: string;
  feedId: string;
  candidates: number;
  scored: number;
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
    return false;
  });

  // Prioritize the most promising events first (heuristic) within the batch.
  needScore.sort((a, b) => heuristicScore(b) - heuristicScore(a));
  const work = needScore.slice(0, batch);

  resetUsage();
  let scored = 0;
  for (const e of work) {
    try {
      const result = await scoreEvent(feed, e, tz);
      await writeScore(feed, e, result);
      scored++;
    } catch (err) {
      log.warn(`score failed for event ${e.id} (${e.title})`, err);
    }
  }

  const tok = usage();
  log.info(
    `scorer[${feed.id}]: scored ${scored}/${needScore.length} needing (of ${candidates.length} candidates); tokens in=${tok.input} out=${tok.output}`,
  );
  return {
    feedId: feed.id,
    candidates: candidates.length,
    scored,
    tokens: tok,
  };
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

async function scoreEvent(feed: FeedRow, e: EventRow, tz: string): Promise<ScoreResult> {
  const speakers = (e.speakers ?? []) as PersonRef[];
  const hosts = (e.hosts ?? []) as PersonRef[];
  const names = [...hosts, ...speakers].map((p) => p.name).filter(Boolean);
  const profiles = await resolvePeople(names);

  const people: ScoringPerson[] = [
    ...hosts.map((h) => toScoringPerson(h, "host", profiles)),
    ...speakers.map((s) => toScoringPerson(s, "speaker", profiles)),
  ];

  return scoreWithRubric({
    rubric: feed.scoringRubric,
    model: feed.model || process.env.SCORING_MODEL || "claude-opus-4-8",
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
  if (hosts.length) {
    lines.push("HOSTS (with researched signals where available):");
    for (const h of hosts) lines.push(describe(h));
  }
  if (speakers.length) {
    lines.push("SPEAKERS / FEATURED GUESTS (with researched signals where available):");
    for (const s of speakers) lines.push(describe(s));
  }
  if (!hosts.length && !speakers.length) {
    lines.push("NAMED PEOPLE: none surfaced (the room is unknown — weigh accordingly).");
  }

  lines.push(
    "\nScore this event's QUALITY for the feed's founder/investor audience using the rubric. Weigh WHO IS IN THE ROOM as heavily as the topic.",
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
      tldr: r.tldr ?? null,
      signals: r.signals ?? {},
      model: feed.model || process.env.SCORING_MODEL || "claude-opus-4-8",
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
        tldr: r.tldr ?? null,
        signals: r.signals ?? {},
        model: feed.model || process.env.SCORING_MODEL || "claude-opus-4-8",
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
