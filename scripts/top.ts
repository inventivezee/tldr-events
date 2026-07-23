// Show the current top-scored events for a feed. Usage: npm run top [feed_id]
import "./_env";
import { getDb, schema, sqlClient } from "../src/db/client";
import { and, desc, eq } from "drizzle-orm";
import { TIER_ICON } from "../src/scoring/tiers";
import { fmtLocalDateTime } from "../src/lib/time";
import type { Tier } from "../src/types";

async function main() {
  const feedId = process.argv[2] || "bay_founder";
  const db = getDb();
  const rows = await db
    .select({
      title: schema.events.title,
      city: schema.events.city,
      startsAt: schema.events.startsAt,
      score: schema.scores.score,
      tier: schema.scores.tier,
      tldr: schema.scores.tldr,
      tag: schema.scores.categoryTag,
    })
    .from(schema.scores)
    .innerJoin(schema.events, eq(schema.events.id, schema.scores.eventId))
    .where(and(eq(schema.scores.feedId, feedId), eq(schema.events.isPrimary, true)))
    .orderBy(desc(schema.scores.score))
    .limit(20);

  console.log(`\nTop scored events for feed "${feedId}":\n`);
  for (const r of rows) {
    const icon = TIER_ICON[r.tier as Tier] ?? "";
    const when = fmtLocalDateTime(r.startsAt, "America/Los_Angeles");
    console.log(`${icon} ${r.score}/10  ${r.title}  [${r.tag ?? "?"}]`);
    console.log(`   ${when} PT · ${r.city ?? "—"}`);
    console.log(`   ${r.tldr ?? ""}\n`);
  }
  await sqlClient().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
