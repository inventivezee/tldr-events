// Idempotent seed: upserts the launch region, sources, and the bay_founder feed.
// Safe to re-run; the feed's rubric is refreshed from code on each run. The
// model is NOT — it comes from deployment config (see feeds.model below).
import "./_env";
import { getDb, sqlClient, schema } from "../src/db/client";
import { SEED_REGION, SEED_SOURCES, SEED_FEED } from "../src/seed/data";
import { BAY_FOUNDER_RUBRIC_V1, RUBRIC_VERSION } from "../src/scoring/rubric";

async function main() {
  const db = getDb();

  await db
    .insert(schema.regions)
    .values(SEED_REGION)
    .onConflictDoUpdate({
      target: schema.regions.id,
      set: { name: SEED_REGION.name, timezone: SEED_REGION.timezone },
    });
  console.log(`region: ${SEED_REGION.id}`);

  for (const s of SEED_SOURCES) {
    await db
      .insert(schema.sources)
      .values({
        id: s.id,
        name: s.name,
        kind: s.kind,
        regionId: s.region_id,
        priority: s.priority,
        config: s.config,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: schema.sources.id,
        set: {
          name: s.name,
          kind: s.kind,
          regionId: s.region_id,
          priority: s.priority,
          config: s.config,
        },
      });
    console.log(`source: ${s.id}`);
  }

  // feeds.model is a DELIBERATE per-feed override, not a seed side effect. Seeding
  // it from a local env var is what pinned "claude-opus-4-8" into the database and
  // silently broke every scoring call after the provider moved to DeepSeek — the
  // pin outranks SCORING_MODEL. Leave it null so deployment config governs, and
  // set it by hand for a genuine per-feed A/B.
  const channelId = process.env.TELEGRAM_CHANNEL_ID || null;

  await db
    .insert(schema.feeds)
    .values({
      id: SEED_FEED.id,
      name: SEED_FEED.name,
      regionId: SEED_FEED.region_id,
      categories: SEED_FEED.categories,
      sourceIds: SEED_FEED.source_ids,
      scoringRubric: BAY_FOUNDER_RUBRIC_V1,
      rubricVersion: RUBRIC_VERSION,
      model: null,
      minScore: SEED_FEED.min_score,
      curator: SEED_FEED.curator,
      postSchedule: SEED_FEED.post_schedule,
      telegramChannelId: channelId,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: schema.feeds.id,
      set: {
        name: SEED_FEED.name,
        categories: SEED_FEED.categories,
        sourceIds: SEED_FEED.source_ids,
        scoringRubric: BAY_FOUNDER_RUBRIC_V1,
        rubricVersion: RUBRIC_VERSION,
        // model deliberately NOT overwritten — see above.
        minScore: SEED_FEED.min_score,
        curator: SEED_FEED.curator,
        postSchedule: SEED_FEED.post_schedule,
        // Only overwrite the channel id when one is configured, so re-seeding
        // without the env var doesn't wipe a previously set channel.
        ...(channelId ? { telegramChannelId: channelId } : {}),
      },
    });
  console.log(
    `feed: ${SEED_FEED.id} (model: from env, rubric v${RUBRIC_VERSION})`,
  );

  console.log("Seed complete.");
  await sqlClient().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
