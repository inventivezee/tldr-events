import { describe, it, expect } from "vitest";
import {
  normalizeText,
  normalizeVenue,
  normalizeName,
  tokenSetRatio,
  haversineMeters,
} from "@/lib/text";

describe("normalizeText", () => {
  it("lowercases, strips punctuation, expands &", () => {
    expect(normalizeText("AI & Founders' Dinner!")).toBe("ai and founders dinner");
  });
  it("handles null", () => {
    expect(normalizeText(null)).toBe("");
  });
});

describe("normalizeVenue", () => {
  it("drops stopwords", () => {
    expect(normalizeVenue("The Frontier Tower HQ")).toBe("frontier tower");
  });
});

describe("tokenSetRatio", () => {
  it("merges title variants with extra qualifiers (≥90)", () => {
    expect(
      tokenSetRatio("AI Founder Dinner", "AI Founders' Dinner @ SoMa"),
    ).toBeGreaterThanOrEqual(90);
  });
  it("keeps genuinely different events apart (<90)", () => {
    expect(
      tokenSetRatio("Longevity Investor Roundtable", "Fintech Happy Hour"),
    ).toBeLessThan(90);
  });
});

describe("normalizeName", () => {
  it("normalizes to a dedup key", () => {
    expect(normalizeName("Dr. Jane A. Doe")).toContain("jane");
    expect(normalizeName("Jane Doe")).toBe("jane doe");
  });
});

describe("haversineMeters", () => {
  it("~0 for same point", () => {
    expect(haversineMeters(37.77, -122.41, 37.77, -122.41)).toBeLessThan(1);
  });
  it("within 200m for a close point", () => {
    expect(haversineMeters(37.7749, -122.4194, 37.7757, -122.4194)).toBeLessThan(200);
  });
});
