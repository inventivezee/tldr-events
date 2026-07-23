import { describe, it, expect } from "vitest";
import { tierFromScore } from "@/scoring/tiers";
import { heuristicScore } from "@/scoring/heuristic";
import type { EventRow } from "@/db/schema";

describe("tierFromScore", () => {
  it("maps boundaries per §11.6", () => {
    expect(tierFromScore(8)).toBe("dont_miss");
    expect(tierFromScore(7.9)).toBe("strong");
    expect(tierFromScore(6)).toBe("strong");
    expect(tierFromScore(5.9)).toBe("radar");
  });
});

function ev(partial: Partial<EventRow>): EventRow {
  return {
    title: "",
    description: null,
    guestCount: null,
    speakers: [],
    hosts: [],
    categories: [],
    ...partial,
  } as unknown as EventRow;
}

describe("heuristicScore", () => {
  it("ranks a demo day above a beginner webinar", () => {
    const demo = heuristicScore(
      ev({ title: "Startup Demo Day", guestCount: 250, categories: ["founder_investor"] }),
    );
    const webinar = heuristicScore(
      ev({ title: "Intro 101 Webinar (virtual only)", description: "beginner course" }),
    );
    expect(demo).toBeGreaterThan(webinar);
  });
  it("stays within [0,10]", () => {
    const s = heuristicScore(ev({ title: "Founder investor demo day pitch", guestCount: 999 }));
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(10);
  });
});
