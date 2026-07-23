import { describe, it, expect } from "vitest";
import { categorize } from "@/ingestion/categorize";

describe("categorize", () => {
  it("tags AI + founder for a founders dinner", () => {
    const c = categorize("AI Founder Dinner", "Meet other founders building with LLMs");
    expect(c).toContain("ai");
    expect(c).toContain("founder_investor");
  });
  it("tags hackathon + fintech for a web3 hackathon", () => {
    const c = categorize("Web3 Hackathon", "Build onchain apps");
    expect(c).toContain("hackathon");
    expect(c).toContain("fintech_blockchain");
  });
  it("returns nothing for a generic beginner course", () => {
    expect(categorize("Intro to Watercolor Painting", "Beginners welcome")).toEqual([]);
  });
});
