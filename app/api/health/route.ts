// Lightweight health check: confirms the runtime can reach the DB and see the
// seeded feed. Returns no infra details (host/creds/errors) publicly.
import { getDb, schema } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const feeds = await db.select({ id: schema.feeds.id }).from(schema.feeds);
    const events = await db.select({ id: schema.events.id }).from(schema.events).limit(1);
    return Response.json({ ok: true, feeds: feeds.length, hasEvents: events.length > 0 });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
