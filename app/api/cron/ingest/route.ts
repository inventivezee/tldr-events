import { NextResponse } from "next/server";
import { cronAuthorized } from "@/cron/guard";
import { dailyRunDue, skippedResponse } from "@/cron/window";
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
  // Pipeline runs once a day, starting at the local run hour (see cron/window).
  if (!dailyRunDue(req)) return NextResponse.json(skippedResponse());
  const r = await withJobLock(LOCK.ingest, LOCK_TTL.ingest, () =>
    runIngestion({ excludeSourceIds: EXTRA_SOURCE_IDS }),
  );
  return NextResponse.json(r.ran ? { ok: true, ...r.result } : { ok: true, skipped: "locked" });
}
