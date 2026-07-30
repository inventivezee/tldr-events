import "./_env";
import { getDb, schema, sqlClient } from "../src/db/client";
import { eq } from "drizzle-orm";
import { BAY_FOUNDER_RUBRIC_V1, RUBRIC_VERSION } from "../src/scoring/rubric";
import { runScorer } from "../src/scoring/scorer";
const db = getDb();
// The prompt's rubric comes from the feed row, not from code — update both.
await db.update(schema.feeds)
  .set({ scoringRubric: BAY_FOUNDER_RUBRIC_V1, rubricVersion: RUBRIC_VERSION })
  .where(eq(schema.feeds.enabled, true));
console.log("feed rubric -> v" + RUBRIC_VERSION, "| speakers-over-hosts:", BAY_FOUNDER_RUBRIC_V1.includes("Speakers count for much more than hosts"));
let total = 0, r = 0;
while (r < 15) {
  const arr: any[] = await runScorer({ batch: 60 });
  const s = arr.reduce((n, x) => n + (x?.scored ?? 0), 0);
  total += s; console.log(`round ${++r}: ${s}`);
  if (!s) break;
}
console.log("re-scored:", total);
await sqlClient().end();
