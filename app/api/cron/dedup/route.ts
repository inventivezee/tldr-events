import { NextResponse } from "next/server";
import { cronAuthorized } from "@/cron/guard";
import { withJobLock, LOCK, LOCK_TTL } from "@/db/client";
import { runDedup } from "@/dedup/canonicalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const r = await withJobLock(LOCK.dedup, LOCK_TTL.dedup, () => runDedup());
  return NextResponse.json(r.ran ? { ok: true, ...r.result } : { ok: true, skipped: "locked" });
}
