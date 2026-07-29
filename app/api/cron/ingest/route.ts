import { NextResponse } from "next/server";
import { cronAuthorized, manualRun } from "@/cron/guard";
import { withJobLock, LOCK, LOCK_TTL } from "@/db/client";
import { runIngestion } from "@/ingestion/runner";
import { EXTRA_SOURCE_IDS } from "@/seed/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Core sources (Luma + Eventbrite + Cerebral Valley). The slower supplemental
// sources (Partiful, Google) run in /api/cron/ingest-extra so neither starves.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  // Manual-only: the scheduled chain runs via /api/cron/pipeline.
  if (!manualRun(req))
    return NextResponse.json({ ok: true, skipped: "manual only — use /api/cron/pipeline" });
  const r = await withJobLock(LOCK.ingest, LOCK_TTL.ingest, () =>
    runIngestion({ excludeSourceIds: EXTRA_SOURCE_IDS }),
  );
  return NextResponse.json(r.ran ? { ok: true, ...r.result } : { ok: true, skipped: "locked" });
}
