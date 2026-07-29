import { NextResponse } from "next/server";
import { cronAuthorized, manualRun } from "@/cron/guard";
import { withJobLock, LOCK, LOCK_TTL } from "@/db/client";
import { runDigestPoster } from "@/digest/poster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  // Manual-only: the scheduled chain runs via /api/cron/pipeline.
  if (!manualRun(req))
    return NextResponse.json({ ok: true, skipped: "manual only — use /api/cron/pipeline" });
  const r = await withJobLock(LOCK.digest, LOCK_TTL.digest, () => runDigestPoster());
  return NextResponse.json(r.ran ? { ok: true, results: r.result } : { ok: true, skipped: "locked" });
}
