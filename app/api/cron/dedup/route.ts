import { NextResponse } from "next/server";
import { cronAuthorized } from "@/cron/guard";
import { stageDue, skippedResponse, STAGE_HOUR } from "@/cron/window";
import { withJobLock, LOCK, LOCK_TTL } from "@/db/client";
import { runDedup } from "@/dedup/canonicalize";
import { runLumaBackfill } from "@/ingestion/luma-backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  // Runs once a day, in this stage's local hour (see cron/window).
  if (!stageDue(req, STAGE_HOUR.dedup))
    return NextResponse.json(skippedResponse(STAGE_HOUR.dedup));
  const r = await withJobLock(LOCK.dedup, LOCK_TTL.dedup, async () => {
    // Enrich cross-source lu.ma links (attendance + hosts) BEFORE dedup, so the
    // canonical primary and the scorer both see the real numbers. Fail-soft: a
    // backfill error must never abort the dedup pass.
    let backfill: unknown = { skipped: "error" };
    try {
      backfill = await runLumaBackfill();
    } catch (e) {
      backfill = { error: e instanceof Error ? e.message : String(e) };
    }
    const dedup = await runDedup();
    return { backfill, dedup };
  });
  return NextResponse.json(r.ran ? { ok: true, ...r.result } : { ok: true, skipped: "locked" });
}
