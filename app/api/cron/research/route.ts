import { NextResponse } from "next/server";
import { cronAuthorized, manualRun } from "@/cron/guard";
import { withJobLock, LOCK, LOCK_TTL } from "@/db/client";
import { runResearch } from "@/research/speakers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  // Manual-only: the scheduled chain runs via /api/cron/pipeline.
  if (!manualRun(req))
    return NextResponse.json({ ok: true, skipped: "manual only — use /api/cron/pipeline" });
  const r = await withJobLock(LOCK.research, LOCK_TTL.research, () => runResearch());
  return NextResponse.json(r.ran ? { ok: true, ...r.result } : { ok: true, skipped: "locked" });
}
