import { NextResponse } from "next/server";
import { cronAuthorized } from "@/cron/guard";
import { stageDue, skippedResponse, STAGE_HOUR } from "@/cron/window";
import { withJobLock, LOCK, LOCK_TTL } from "@/db/client";
import { runResearch } from "@/research/speakers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  // Runs once a day, in this stage's local hour (see cron/window).
  if (!stageDue(req, STAGE_HOUR.research))
    return NextResponse.json(skippedResponse(STAGE_HOUR.research));
  const r = await withJobLock(LOCK.research, LOCK_TTL.research, () => runResearch());
  return NextResponse.json(r.ran ? { ok: true, ...r.result } : { ok: true, skipped: "locked" });
}
