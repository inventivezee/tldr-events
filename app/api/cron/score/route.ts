import { NextResponse } from "next/server";
import { cronAuthorized } from "@/cron/guard";
import { withJobLock, LOCK } from "@/db/client";
import { runScorer } from "@/scoring/scorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const r = await withJobLock(LOCK.score, () => runScorer());
  return NextResponse.json(r.ran ? { ok: true, feeds: r.result } : { ok: true, skipped: "locked" });
}
