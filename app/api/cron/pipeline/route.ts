import { NextResponse } from "next/server";
import { cronAuthorized } from "@/cron/guard";
import { runPipelineTick } from "@/cron/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The project's ONLY cron. Each tick advances the daily chain by at most one
// stage (see src/cron/pipeline.ts for why a single job replaced six).
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  const r = await runPipelineTick({ force });
  return NextResponse.json({ ok: true, ...r });
}
