import { NextResponse } from "next/server";
import { cronAuthorized } from "@/cron/guard";
import { configSummary, selfTest, usage, resetUsage } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "What model is this deployment actually using, and can it reach it?"
 *
 * Authenticated because it reveals configuration. Add `?live=1` to make one real
 * call to the provider — the only way to distinguish a good key from a bad one.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const config = configSummary();
  if (new URL(req.url).searchParams.get("live") !== "1") {
    return NextResponse.json({ ok: true, config });
  }
  resetUsage();
  const test = await selfTest();
  return NextResponse.json({ ok: test.ok, config, test, tokens: usage() });
}
