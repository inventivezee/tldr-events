// Hour-gating for the daily pipeline crons.
//
// The gather → post chain runs ONCE a day. Vercel Cron only speaks UTC, which
// drifts an hour across DST, so each stage is scheduled at BOTH candidate UTC
// hours and this gate admits only the one that is actually the right local hour;
// the other returns immediately having done nothing.
//
// IMPORTANT — why every stage is scheduled at MINUTE 0:
// On 2026-07-27 the stages scheduled at minute offsets (dedup :06, research :10,
// research :17, score :14/:19/:24) did not fire at all, while the minute-0 jobs
// (ingest, ingest-extra) ran on time. Minute-offset delivery is not dependable
// here, so stages are spread across separate HOURS at minute 0 instead of packed
// into one hour at different minutes. The digest additionally tolerates a missed
// tick via its own catch-up window (see digest/poster.ts).
//
// Local timeline, matching the vercel.json `crons` entries:
//   15:00  ingest (core) + ingest-extra, in parallel (separate job locks)
//   16:00  dedup + Luma attendance backfill, and speaker research
//   17:00  scoring
//   17:30  digest posts (catch-up keeps trying if that tick is missed)
//
// NOTE: vercel.json rejects unknown keys (a `_comment` there fails schema
// validation and the deploy never builds), so this note lives in code.
import { localHourAndDow } from "@/lib/time";

/** Region-local clock the schedule is expressed in. */
export const SCHEDULE_TZ = process.env.SCHEDULE_TZ || "America/Los_Angeles";

/** Local hours each stage is allowed to run in. */
export const STAGE_HOUR = {
  ingest: 15,
  dedup: 16,
  research: 16,
  score: 17,
} as const;

/**
 * True when this stage should run now: during its local hour, or when the caller
 * passes ?force=1 (already cron-authorized) for a manual/backfill run.
 */
export function stageDue(
  req: Request,
  hours: number | number[],
  now = new Date(),
): boolean {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("force") === "1") return true;
  } catch {
    /* ignore */
  }
  const allowed = Array.isArray(hours) ? hours : [hours];
  return allowed.includes(localHourAndDow(now, SCHEDULE_TZ).hour);
}

/** Body for a cron invocation that fired outside its stage hour. */
export function skippedResponse(hours: number | number[]) {
  return {
    ok: true,
    skipped: "outside stage hour",
    stageHours: Array.isArray(hours) ? hours : [hours],
    tz: SCHEDULE_TZ,
  };
}
