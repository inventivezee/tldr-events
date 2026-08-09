import { describe, it, expect } from "vitest";
import { shouldExtendThisWeek, clearsFloor, BOARD_VISIBLE_MIN_SCORE } from "@/web/data";

const ev = (score: number, relevant = true) => ({ score, relevant });

describe("this-week board falls forward when the week is spent", () => {
  // By Sunday the window covers one day, which regularly leaves nothing above
  // the floor while the week ahead is full — the board looked broken.
  it("extends when nothing clears the floor", () => {
    expect(shouldExtendThisWeek("this-week", [])).toBe(true);
    expect(shouldExtendThisWeek("this-week", [ev(6.4), ev(5.0), ev(2.1)])).toBe(true);
  });

  it("leaves a week alone as soon as one event clears the floor", () => {
    expect(shouldExtendThisWeek("this-week", [ev(BOARD_VISIBLE_MIN_SCORE)])).toBe(false);
    expect(shouldExtendThisWeek("this-week", [ev(6.4), ev(8.9)])).toBe(false);
  });

  it("ignores events that are merely irrelevant-but-high-scoring", () => {
    // A bar crawl scoring 9 is still not a reason to call the week full.
    expect(shouldExtendThisWeek("this-week", [ev(9.0, false)])).toBe(true);
    expect(clearsFloor([ev(9.0, false), ev(7.0, true)])).toHaveLength(1);
  });

  it("never rewrites the other horizons", () => {
    for (const range of ["today", "tomorrow", "next-week"] as const) {
      expect(shouldExtendThisWeek(range, [])).toBe(false);
    }
    expect(shouldExtendThisWeek({ day: "2026-08-09" }, [])).toBe(false);
  });
});
