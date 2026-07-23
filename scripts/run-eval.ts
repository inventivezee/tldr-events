// Score the labeled set with the current rubric + model and print the report.
// Usage: npm run eval
import "./_env";
import { runEval } from "../src/eval/runner";
import { llmConfigured } from "../src/lib/llm";

async function main() {
  if (!llmConfigured()) {
    console.error("LLM not configured (set LLM_API_KEY). Cannot run eval.");
    process.exit(1);
  }
  const model = process.env.SCORING_MODEL || "claude-opus-4-8";
  console.log(`Evaluating rubric with model=${model}…\n`);
  const report = await runEval(model);

  for (const r of report.rows) {
    const mark = r.hit ? "✓" : "✗";
    console.log(
      `${mark} [${r.score.toFixed(1)}] exp=${r.expected.padEnd(9)} got=${r.got.padEnd(9)} ${r.title}`,
    );
    console.log(`     tldr: ${r.tldr}`);
  }
  console.log("\n──────── Summary ────────");
  console.log(`Events:              ${report.n}`);
  console.log(`Top-tier precision:  ${(report.topTierPrecision * 100).toFixed(0)}%`);
  console.log(`Top-tier recall:     ${(report.topTierRecall * 100).toFixed(0)}%`);
  console.log(`Exact-tier accuracy: ${(report.exactTierAccuracy * 100).toFixed(0)}%`);
  console.log(
    "\nGoal: top-tier precision high (Don't-Miss picks are trustworthy). Iterate the rubric until it is, then bump RUBRIC_VERSION.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
