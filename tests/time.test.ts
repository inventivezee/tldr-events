import { describe, it, expect } from "vitest";
import {
  parseToUtc,
  parseLoose,
  fmtLocalTime,
  startLocalDate,
  dailyWindow,
  weeklyWindow,
  thisWeekWindow,
  nextWeekWindow,
} from "@/lib/time";

const PT = "America/Los_Angeles";

describe("parseToUtc", () => {
  it("honors Z", () => {
    expect(parseToUtc("2026-07-22T18:00:00Z").toISOString()).toBe(
      "2026-07-22T18:00:00.000Z",
    );
  });
  it("honors explicit offset", () => {
    expect(parseToUtc("2026-07-22T18:00:00-04:00").toISOString()).toBe(
      "2026-07-22T22:00:00.000Z",
    );
  });
  it("localizes naive time to source tz (PDT = UTC-7 in July)", () => {
    expect(parseToUtc("2026-07-22T18:00:00", PT).toISOString()).toBe(
      "2026-07-23T01:00:00.000Z",
    );
  });
});

describe("parseLoose", () => {
  it("parses a human card date in PT", () => {
    const d = parseLoose("Jul 22, 2026, 6:00 PM", PT);
    expect(d?.toISOString()).toBe("2026-07-23T01:00:00.000Z");
  });
  it("returns null for garbage", () => {
    expect(parseLoose("sometime soon", PT)).toBeNull();
  });
});

describe("fmtLocalTime", () => {
  it("DST-correct PT rendering", () => {
    expect(fmtLocalTime(new Date("2026-07-22T18:00:00Z"), PT)).toBe("11:00AM");
  });
});

describe("startLocalDate", () => {
  it("uses region-local date, not UTC (avoids midnight mismatch)", () => {
    // 2026-07-23T05:00Z is still 2026-07-22 in PT (22:00).
    expect(startLocalDate(new Date("2026-07-23T05:00:00Z"), PT)).toBe("2026-07-22");
  });
});

describe("windows", () => {
  it("daily window spans ~2 local days", () => {
    const now = new Date("2026-07-22T20:00:00Z");
    const w = dailyWindow(now, PT);
    expect(w.end.getTime()).toBeGreaterThan(w.start.getTime());
    const days = (w.end.getTime() - w.start.getTime()) / 86400000;
    expect(days).toBeGreaterThan(1.5);
    expect(days).toBeLessThan(2.1);
  });
  it("weekly window spans ~7 local days (today..+6, no overlap with next week)", () => {
    const now = new Date("2026-07-22T20:00:00Z");
    const w = weeklyWindow(now, PT);
    const days = (w.end.getTime() - w.start.getTime()) / 86400000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.05);
  });

  it("calendar weeks: Thu Jul 23 → Jul 28 is next week, not this week", () => {
    // Thursday 2026-07-23, ~noon PT.
    const now = new Date("2026-07-23T19:00:00Z");
    const jul28 = new Date("2026-07-29T01:00:00Z"); // Tue Jul 28 6pm PT
    const tw = thisWeekWindow(now, PT);
    const nw = nextWeekWindow(now, PT);
    // Jul 28 excluded from this week, included in next week.
    expect(jul28 >= tw.start && jul28 <= tw.end).toBe(false);
    expect(jul28 >= nw.start && jul28 <= nw.end).toBe(true);
    // This week ends before next week begins (no overlap/gap at the boundary).
    expect(tw.end.getTime()).toBeLessThan(nw.start.getTime());
  });
});
