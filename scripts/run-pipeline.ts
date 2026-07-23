// Run the full pipeline once, locally (PRD §16). Handy for manual runs + QA.
// Usage:
//   npm run pipeline                      # ingest → dedup → research → score
//   npm run pipeline -- ingest dedup      # only named stages
//   npm run pipeline -- digest:daily      # force a daily digest post
//   npm run pipeline -- all digest:weekly # everything + force weekly digest
import "./_env";
import { sqlClient } from "../src/db/client";
import { runIngestion } from "../src/ingestion/runner";
import { runLumaBackfill } from "../src/ingestion/luma-backfill";
import { runDedup } from "../src/dedup/canonicalize";
import { runResearch } from "../src/research/speakers";
import { runScorer } from "../src/scoring/scorer";
import { runDigestPoster } from "../src/digest/poster";

async function main() {
  const args = process.argv.slice(2);
  const wantAll = args.length === 0 || args.includes("all");
  const has = (s: string) => wantAll || args.includes(s);
  const forceDigest = args.find((a) => a.startsWith("digest:"))?.split(":")[1] as
    | "daily"
    | "weekly"
    | undefined;

  if (has("ingest")) {
    console.log("\n=== INGEST ===");
    console.log(JSON.stringify(await runIngestion(), null, 2));
  }
  if (has("dedup")) {
    console.log("\n=== LUMA BACKFILL ===");
    console.log(JSON.stringify(await runLumaBackfill(), null, 2));
    console.log("\n=== DEDUP ===");
    console.log(JSON.stringify(await runDedup(), null, 2));
  }
  if (has("research")) {
    console.log("\n=== RESEARCH ===");
    console.log(JSON.stringify(await runResearch(), null, 2));
  }
  if (has("score")) {
    console.log("\n=== SCORE ===");
    console.log(JSON.stringify(await runScorer(), null, 2));
  }
  if (forceDigest) {
    console.log(`\n=== DIGEST (force ${forceDigest}) ===`);
    console.log(JSON.stringify(await runDigestPoster({ force: forceDigest }), null, 2));
  } else if (args.includes("digest")) {
    console.log("\n=== DIGEST (scheduled check) ===");
    console.log(JSON.stringify(await runDigestPoster(), null, 2));
  }

  await sqlClient().end();
  console.log("\nDone.");
}

main().catch(async (e) => {
  console.error(e);
  try {
    await sqlClient().end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
