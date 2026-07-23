// Heuristic category tagging at ingest (PRD §9.5). HINTS for display/organization
// only — NOT a delivery gate. The authoritative niche is scores.category_tag.
import type { Category } from "@/types";

const RULES: Array<{ cat: Category; re: RegExp }> = [
  {
    cat: "ai",
    re: /\b(ai|a\.i\.|artificial intelligence|machine learning|ml|llm|gpt|genai|gen ai|generative|agent(s|ic)?|neural|deep learning|inference|foundation model)\b/i,
  },
  {
    cat: "longevity",
    re: /\b(longevity|aging|anti-aging|biotech|bio|healthtech|health tech|medicine|clinical|therapeutic|genomics|neuro|wellness|healthspan)\b/i,
  },
  {
    cat: "fintech_blockchain",
    re: /\b(fintech|fin-tech|payments|blockchain|crypto|web3|defi|bitcoin|ethereum|solana|stablecoin|token|onchain|on-chain|capital markets|insurtech)\b/i,
  },
  {
    cat: "hackathon",
    re: /\b(hackathon|hack-a-thon|buildathon|hack night|hacknight|build weekend)\b/i,
  },
  {
    cat: "founder_investor",
    re: /\b(founder|co-?founder|investor|venture|vc\b|angel|demo day|pitch|startup|seed|pre-seed|series [a-c]|lp\b|gp\b|limited partner|fund|accelerator|incubator|operator)\b/i,
  },
];

export function categorize(
  title: string | null | undefined,
  description?: string | null,
): Category[] {
  const hay = `${title ?? ""} \n ${description ?? ""}`;
  const out = new Set<Category>();
  for (const { cat, re } of RULES) {
    if (re.test(hay)) out.add(cat);
  }
  return [...out];
}
