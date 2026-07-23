// Evaluate the current rubric against the labeled set (PRD §11.2, §18 M0).
// Reports top-tier precision (the launch success metric) + a confusion matrix.
import { LABELED_SET, type Label } from "./labeled-set";
import { BAY_FOUNDER_RUBRIC_V1 } from "@/scoring/rubric";
import { scoreWithRubric } from "@/scoring/scorer";
import { tierFromScore } from "@/scoring/tiers";
import type { Tier } from "@/types";

function labelToTier(l: Label): Tier {
  if (l === "dont_miss") return "dont_miss";
  if (l === "strong") return "strong";
  return "radar";
}

export interface EvalRow {
  id: string;
  title: string;
  expected: Tier;
  got: Tier;
  score: number;
  tldr: string;
  hit: boolean;
}

export interface EvalReport {
  rows: EvalRow[];
  topTierPrecision: number; // of model 'dont_miss', share truly dont_miss
  topTierRecall: number; // of true dont_miss, share model caught
  exactTierAccuracy: number;
  n: number;
}

export async function runEval(model: string): Promise<EvalReport> {
  const rows: EvalRow[] = [];

  for (const ev of LABELED_SET) {
    const result = await scoreWithRubric({
      rubric: BAY_FOUNDER_RUBRIC_V1,
      model,
      title: ev.title,
      startsAt: new Date("2026-08-01T02:00:00Z"),
      city: ev.city,
      guestCount: ev.guestCount ?? null,
      categories: ev.categories ?? [],
      description: ev.description,
      people: ev.people ?? [],
    });
    const score = Math.max(0, Math.min(10, Number(result.score)));
    const got = tierFromScore(score);
    const expected = labelToTier(ev.label);
    rows.push({
      id: ev.id,
      title: ev.title,
      expected,
      got,
      score,
      tldr: result.tldr,
      hit: got === expected,
    });
  }

  const modelTop = rows.filter((r) => r.got === "dont_miss");
  const trueTop = rows.filter((r) => r.expected === "dont_miss");
  // If the rubric flags NO top-tier events at all, precision is 0 (a degenerate
  // rubric must not score as "100% precise"), unless there were truly none to find.
  const topTierPrecision = modelTop.length
    ? modelTop.filter((r) => r.expected === "dont_miss").length / modelTop.length
    : trueTop.length === 0
      ? 1
      : 0;
  const topTierRecall = trueTop.length
    ? trueTop.filter((r) => r.got === "dont_miss").length / trueTop.length
    : 1;
  const exactTierAccuracy = rows.filter((r) => r.hit).length / rows.length;

  return {
    rows,
    topTierPrecision,
    topTierRecall,
    exactTierAccuracy,
    n: rows.length,
  };
}
