// Render the Telegram digest message to stdout (no sending). Usage:
//   npm run preview:digest            # weekly
//   npm run preview:digest -- daily
import "./_env";
import { getDb, schema, sqlClient } from "../src/db/client";
import { eq } from "drizzle-orm";
import { queryDeliveryEvents } from "../src/digest/query";
import { renderDigestMessage } from "../src/digest/render";
import { dailyWindow, weeklyWindow } from "../src/lib/time";

async function main() {
  const kind = process.argv.includes("daily") ? "daily" : "weekly";
  const db = getDb();
  const [feed] = await db.select().from(schema.feeds).where(eq(schema.feeds.id, "bay_founder")).limit(1);
  if (!feed) throw new Error("feed not found");
  const [region] = await db.select().from(schema.regions).where(eq(schema.regions.id, feed.regionId ?? "sf_bay")).limit(1);
  const tz = region?.timezone ?? "America/Los_Angeles";
  const now = new Date();
  const window = kind === "daily" ? dailyWindow(now, tz) : weeklyWindow(now, tz);
  const events = await queryDeliveryEvents({
    feedId: feed.id,
    regionId: feed.regionId ?? "sf_bay",
    minScore: Number(feed.minScore ?? "6.0"),
    relevantOnly: true,
    window,
  });
  const msg = renderDigestMessage(feed, events, kind, tz);
  console.log("\n──────── DIGEST PREVIEW (" + kind + ", " + events.length + " events, " + msg.length + " chars) ────────\n");
  console.log(msg.replace(/<a href="([^"]+)">([^<]+)<\/a>/g, "$2 [$1]").replace(/<\/?b>/g, ""));
  await sqlClient().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
