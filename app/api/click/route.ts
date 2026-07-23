// Outbound click logging + redirect (PRD §6, §12, §13). Telegram buttons and web
// cards point here; we log to click_events, then 302 to the event's OWN source
// URL looked up from the DB. The redirect target is NEVER taken from the request
// query string, so this cannot be abused as an open redirect.
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { siteUrl } from "@/lib/links";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger("click");

function isHttp(u: string | null | undefined): u is string {
  if (!u) return false;
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get("e");
  const feedId = searchParams.get("f");
  const surface = searchParams.get("s") === "telegram" ? "telegram" : "web";

  let target = siteUrl();

  if (eventId && /^[0-9a-f-]{36}$/i.test(eventId)) {
    try {
      const db = getDb();
      const [row] = await db
        .select({ url: schema.events.url })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);
      if (isHttp(row?.url)) target = row!.url!;
      // Log best-effort; never block the redirect on a logging failure.
      await db.insert(schema.clickEvents).values({
        eventId,
        feedId: feedId ?? null,
        surface,
      });
    } catch (e) {
      log.warn("click log/lookup failed", e);
    }
  }

  return NextResponse.redirect(target, 302);
}
