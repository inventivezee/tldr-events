// Tier mapping (PRD §11.6).
import type { Tier } from "@/types";

export function tierFromScore(score: number): Tier {
  if (score >= 8) return "dont_miss";
  if (score >= 6) return "strong";
  return "radar";
}

export const TIER_LABEL: Record<Tier, string> = {
  dont_miss: "Must Attend",
  strong: "Strong Pick",
  radar: "Worth a Look",
};

export const TIER_ICON: Record<Tier, string> = {
  dont_miss: "🔥",
  strong: "⭐",
  radar: "👀",
};

export const TIER_ORDER: Record<Tier, number> = {
  dont_miss: 0,
  strong: 1,
  radar: 2,
};

export const CATEGORY_TAG_LABEL: Record<string, string> = {
  ai: "🤖 AI",
  longevity: "🧬 Longevity",
  fintech_blockchain: "💸 Fintech/Blockchain",
  founder_investor: "🤝 Founder/Investor",
  hackathon: "🛠️ Hackathon",
};

export function categoryLabel(tag: string | null | undefined): string {
  if (!tag) return "";
  return CATEGORY_TAG_LABEL[tag] ?? tag;
}
