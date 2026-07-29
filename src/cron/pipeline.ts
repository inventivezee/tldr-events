// Daily pipeline orchestrator.
//
// WHY ONE CRON INSTEAD OF SIX
// Vercel's cron delivery has proved unreliable here in two distinct ways:
//   * 2026-07-27 — stages scheduled at minute offsets (:06, :10, :14) never fired
//     at all, while the minute-0 jobs did.
//   * 2026-07-28 — with everything moved to minute 0, exactly one job ran out of
//     each PAIR that shared a trigger minute: ingest-extra ran but ingest didn't,
//     research ran but dedup didn't. The missed dedup left 48 rows ungrouped and
//     a duplicate event went out in the digest.
// Rather than keep guessing the scheduler's rules, the project now registers a
// SINGLE cron. With one job there is nothing to collide with, and one dropped
// tick costs ten minutes instead of a day.
//
// HOW IT RUNS
// The tick fires every 10 minutes and performs AT MOST ONE stage, so no single
// invocation can approach the function time limit. Stages run in dependency
// order and each is attempted once per local day:
//
//   ingest → ingest_extra → dedup (+ Luma backfill) → research → score → digest
//
// A stage is "done for today" once its job lock shows an attempt today, so a
// missed tick simply retries on the next one and the chain self-heals. The
// digest is not a one-shot either: runDigestPoster decides for itself whether a
// daily or weekly post is due, so it is safe to call on every spare tick.
import { getDb, schema, withJobLock, LOCK_TTL } from "@/db/client";
import { runIngestion } from "@/ingestion/runner";
import { runLumaBackfill } from "@/ingestion/luma-backfill";
import { runDedup } from "@/dedup/canonicalize";
import { runResearch } from "@/research/speakers";
import { runScorer } from "@/scoring/scorer";
import { runDigestPoster } from "@/digest/poster";
import { EXTRA_SOURCE_IDS } from "@/seed/data";
import { dayWindow, localHourAndDow } from "@/lib/time";
import { logger } from "@/lib/logger";

const log = logger("pipeline");

export const SCHEDULE_TZ = process.env.SCHEDULE_TZ || "America/Los_Angeles";

/** Local hour the daily gather starts. Everything else follows behind it. */
export const PIPELINE_START_HOUR = Number(process.env.PIPELINE_START_HOUR ?? 15);

export interface Stage {
  /** job_locks name — also how "already attempted today" is determined. */
  name: string;
  run: () => Promise<unknown>;
  ttl: number;
}

export const STAGES: Stage[] = [
  {
    name: "ingest",
    ttl: LOCK_TTL.ingest,
    run: () => runIngestion({ excludeSourceIds: EXTRA_SOURCE_IDS }),
  },
  {
    name: "ingest_extra",
    ttl: LOCK_TTL.ingest,
    run: () => runIngestion({ sourceIds: EXTRA_SOURCE_IDS }),
  },
  {
    name: "dedup",
    ttl: LOCK_TTL.dedup,
    run: async () => {
      // Enrich cross-source lu.ma links before grouping, so the canonical row and
      // the scorer both see real attendance. Fail-soft: never abort dedup.
      let backfill: unknown = { skipped: "error" };
      try {
        backfill = await runLumaBackfill();
      } catch (e) {
        backfill = { error: e instanceof Error ? e.message : String(e) };
      }
      return { backfill, dedup: await runDedup() };
    },
  },
  { name: "research", ttl: LOCK_TTL.research, run: () => runResearch() },
  { name: "score", ttl: LOCK_TTL.score, run: () => runScorer() },
];

export interface TickResult {
  ran: string | null;
  result?: unknown;
  skipped?: string;
  pending?: string[];
}

/** Stages whose lock shows no attempt since the start of the local day. */
async function pendingStages(now: Date): Promise<string[]> {
  const db = getDb();
  const todayStart = dayWindow(now, SCHEDULE_TZ, 0).start;
  const locks = await db.select().from(schema.jobLocks);
  const lastRun = new Map(locks.map((l) => [l.name, l.updatedAt]));
  return STAGES.filter((s) => {
    const at = lastRun.get(s.name);
    return !at || at < todayStart;
  }).map((s) => s.name);
}

/**
 * One tick: run the first pending stage, or fall through to the digest.
 * `force` (from ?force=1 on an already-authorized request) ignores the start
 * hour, for manual runs.
 */
export async function runPipelineTick(opts?: { force?: boolean; now?: Date }): Promise<TickResult> {
  const now = opts?.now ?? new Date();
  const { hour } = localHourAndDow(now, SCHEDULE_TZ);

  // Before the gather window, only the digest may act (it self-gates, and the
  // weekly posts at its own hour).
  const gathering = opts?.force || hour >= PIPELINE_START_HOUR;
  const pending = gathering ? await pendingStages(now) : [];

  if (pending.length) {
    const stage = STAGES.find((s) => s.name === pending[0])!;
    log.info(`tick: running ${stage.name} (pending: ${pending.join(", ")})`);
    const r = await withJobLock(stage.name, stage.ttl, stage.run);
    return r.ran
      ? { ran: stage.name, result: r.result, pending: pending.slice(1) }
      : { ran: null, skipped: `${stage.name} locked`, pending };
  }

  // Nothing left to gather — let the poster decide if a digest is due.
  const posted = await withJobLock("digest", LOCK_TTL.digest, () => runDigestPoster());
  return posted.ran
    ? { ran: "digest", result: posted.result, pending: [] }
    : { ran: null, skipped: "digest locked", pending: [] };
}
