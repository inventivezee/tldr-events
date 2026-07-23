// Diagnostic: reports whether the deployed runtime can reach the DB and see the
// seeded feed. Exposes only the DB HOST (no credentials). Safe to keep.
import { getDb, schema } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.DATABASE_URL || "";
  let dbHost = "(unset)";
  try {
    dbHost = new URL(url).host;
  } catch {
    dbHost = url ? "(unparseable)" : "(unset)";
  }
  try {
    const db = getDb();
    const feeds = await db.select({ id: schema.feeds.id }).from(schema.feeds);
    const events = await db.select({ id: schema.events.id }).from(schema.events).limit(1);
    return Response.json({
      ok: true,
      dbHost,
      feeds: feeds.map((f) => f.id),
      hasEvents: events.length > 0,
    });
  } catch (e) {
    return Response.json(
      { ok: false, dbHost, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
