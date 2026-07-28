import { NextResponse } from "next/server";
import { cronAuthorized } from "@/cron/guard";
import { stageDue, skippedResponse, STAGE_HOUR } from "@/cron/window";
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
  // Runs once a day, in this stage's local hour (see cron/window).
  if (!stageDue(req, STAGE_HOUR.ingest))
    return NextResponse.json(skippedResponse(STAGE_HOUR.ingest));
  const r = await withJobLock(LOCK.ingest, LOCK_TTL.ingest, () =>
    runIngestion({ excludeSourceIds: EXTRA_SOURCE_IDS }),
  );
  return NextResponse.json(r.ran ? { ok: true, ...r.result } : { ok: true, skipped: "locked" });
}
