import { NextResponse } from "next/server";
import { cronAuthorized } from "@/cron/guard";
import { withJobLock, LOCK } from "@/db/client";
import { runDigestPoster } from "@/digest/poster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const r = await withJobLock(LOCK.digest, () => runDigestPoster());
  return NextResponse.json(r.ran ? { ok: true, results: r.result } : { ok: true, skipped: "locked" });
}
