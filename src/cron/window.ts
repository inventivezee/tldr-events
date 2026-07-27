// Daily-run gating for the pipeline crons.
//
// The gather → post chain runs ONCE a day, kicked off at 17:00 local so the 5pm
// digest previews tomorrow with fresh data. Vercel Cron only speaks UTC, which
// drifts an hour across DST, so each stage in vercel.json is scheduled at BOTH
// candidate UTC hours (00:00 UTC = 17:00 PDT, 01:00 UTC = 17:00 PST) and this
// gate lets only the one that is actually 17:00 local do the work; the other
// returns immediately.
//
// Local timeline, matching the vercel.json `crons` entries:
//   :00        ingest (core) + ingest-extra, in parallel (separate job locks)
//   :06        dedup + Luma attendance backfill
//   :10, :17   speaker research
//   :14,:19,:24 scoring (batched)
//   :30        digest posts (poster holds the daily until DAILY_POST_AFTER_MINUTE)
//
// The digest cron itself stays frequent — it also serves the Sunday 18:00 weekly
// — so it is NOT gated here.
//
// NOTE: vercel.json rejects unknown keys (a `_comment` there fails schema
// validation and the deploy never builds), so this note lives in code.
import { localHourAndDow } from "@/lib/time";

/** Region-local clock the schedule is expressed in. */
export const SCHEDULE_TZ = process.env.SCHEDULE_TZ || "America/Los_Angeles";

/** The hour (local) the daily gather+post chain starts. */
export const DAILY_RUN_HOUR = Number(process.env.DAILY_RUN_HOUR ?? 17);

/**
 * True when the pipeline should run now: during the local run hour, or when the
 * caller passes ?force=1 (already cron-authorized) for a manual/backfill run.
 */
export function dailyRunDue(req: Request, now = new Date()): boolean {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("force") === "1") return true;
  } catch {
    /* ignore */
  }
  return localHourAndDow(now, SCHEDULE_TZ).hour === DAILY_RUN_HOUR;
}

/** Body for a cron invocation that fired outside the daily run hour. */
export function skippedResponse() {
  return {
    ok: true,
    skipped: "outside daily run hour",
    runHour: DAILY_RUN_HOUR,
    tz: SCHEDULE_TZ,
  };
}
