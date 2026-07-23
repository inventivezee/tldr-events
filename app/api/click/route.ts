// Outbound click logging + redirect (PRD §6, §12, §13). Telegram buttons and web
// cards both point here; we log to click_events, then 302 to the source URL.
import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/db/client";
import { siteUrl } from "@/lib/links";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger("click");

function safeTarget(u: string | null): string {
  if (!u) return siteUrl();
  try {
    const parsed = new URL(u);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch {
    /* fall through */
  }
  return siteUrl();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get("e");
  const feedId = searchParams.get("f");
  const surface = searchParams.get("s") === "telegram" ? "telegram" : "web";
  const target = safeTarget(searchParams.get("u"));

  // Log best-effort; never block the redirect on a logging failure.
  if (eventId && /^[0-9a-f-]{36}$/i.test(eventId)) {
    try {
      await getDb().insert(schema.clickEvents).values({
        eventId,
        feedId: feedId ?? null,
        surface,
      });
    } catch (e) {
      log.warn("click log failed", e);
    }
  }

  return NextResponse.redirect(target, 302);
}
