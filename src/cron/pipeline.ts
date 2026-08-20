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
import { getDb, schema, sqlClient, withJobLock, LOCK_TTL } from "@/db/client";
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
  /**
   * Optional: a stage that processes a QUEUE rather than happening once. When
   * this returns true the stage runs again on a later tick even though it has
   * already been attempted today, and it may do so outside the gather window —
   * draining a backlog is not gathering.
   */
  hasBacklog?: () => Promise<boolean>;
}

/** Ceiling on scoring work per local day, so a permanently-failing event can't
 *  turn the drain loop into an unbounded spend. */
const DAILY_SCORE_CAP = Number(process.env.DAILY_SCORE_CAP ?? 500);

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
  {
    name: "score",
    ttl: LOCK_TTL.score,
    run: () => runScorer(),
    // Scoring is batch-limited per run so no single invocation nears the
    // function timeout. Before this, "attempted today" marked it done after ONE
    // batch — capacity was sized for the three daily cron slots it had before
    // the pipeline was consolidated into one, so the window silently ran a
    // permanent backlog (327 of 377 events unscored, i.e. invisible to the site
    // and the digest). It now keeps going until the queue is empty.
    hasBacklog: scoringBacklog,
  },
];

/** True while events in the scoring window still have no score for a live feed. */
async function scoringBacklog(): Promise<boolean> {
  const [row] = (await sqlClient()`
    select
      (select count(*) from events e
         join feeds f on f.enabled
         left join scores s on s.event_id = e.id and s.feed_id = f.id
        where e.is_primary and e.status = 'active'
          and e.starts_at > now() and e.starts_at < now() + interval '21 days'
          and s.event_id is null)::int as unscored,
      -- Converted BACK to timestamptz: date_trunc on a zone-shifted now()
      -- yields a NAIVE local timestamp, and comparing that against a timestamptz
      -- would have it re-read as UTC — the cap would reset hours early.
      (select count(*) from scores
        where scored_at > (date_trunc('day', now() at time zone ${SCHEDULE_TZ})
                             at time zone ${SCHEDULE_TZ}))::int as scored_today
  `) as unknown as { unscored: number; scored_today: number }[];
  // Column aliases come back snake_case from Postgres; reading a camelCase key
  // here silently yielded undefined, and `undefined < cap` is false — the drain
  // never started.
  return row.unscored > 0 && row.scored_today < DAILY_SCORE_CAP;
}

export interface TickResult {
  ran: string | null;
  result?: unknown;
  skipped?: string;
  pending?: string[];
}

/**
 * What still needs doing: stages not yet attempted today (only once the gather
 * window has opened), plus any queue-draining stage that still has a backlog —
 * those run at any hour, since catching up isn't gathering.
 */
async function pendingStages(now: Date, gathering: boolean): Promise<string[]> {
  const db = getDb();
  const todayStart = dayWindow(now, SCHEDULE_TZ, 0).start;
  const locks = await db.select().from(schema.jobLocks);
  const lastRun = new Map(locks.map((l) => [l.name, l.updatedAt]));

  const out: string[] = [];
  for (const s of STAGES) {
    const at = lastRun.get(s.name);
    const notRunToday = !at || at < todayStart;
    if (gathering && notRunToday) {
      out.push(s.name);
      continue;
    }
    if (s.hasBacklog && (await s.hasBacklog())) out.push(s.name);
  }
  return out;
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
  const pending = await pendingStages(now, gathering);

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
