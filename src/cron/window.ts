// Daily-run gating for the pipeline crons.
//
// The gather → post chain runs ONCE a day, kicked off at 17:00 local so the 5pm
// digest previews tomorrow with fresh data. Vercel Cron only speaks UTC, which
// drifts an hour across DST, so each stage is scheduled at BOTH candidate UTC
// hours and this gate lets only the one that is actually 17:00 local proceed.
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
