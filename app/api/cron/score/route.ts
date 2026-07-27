import { NextResponse } from "next/server";
import { cronAuthorized } from "@/cron/guard";
import { dailyRunDue, skippedResponse } from "@/cron/window";
import { withJobLock, LOCK, LOCK_TTL } from "@/db/client";
import { runScorer } from "@/scoring/scorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  // Pipeline runs once a day, starting at the local run hour (see cron/window).
  if (!dailyRunDue(req)) return NextResponse.json(skippedResponse());
  const r = await withJobLock(LOCK.score, LOCK_TTL.score, () => runScorer());
  return NextResponse.json(r.ran ? { ok: true, feeds: r.result } : { ok: true, skipped: "locked" });
}
