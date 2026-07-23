import { describe, it, expect } from "vitest";
import {
  parseToUtc,
  parseLoose,
  fmtLocalTime,
  startLocalDate,
  dailyWindow,
  weeklyWindow,
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
  it("weekly window spans ~8 local days", () => {
    const now = new Date("2026-07-22T20:00:00Z");
    const w = weeklyWindow(now, PT);
    const days = (w.end.getTime() - w.start.getTime()) / 86400000;
    expect(days).toBeGreaterThan(7);
    expect(days).toBeLessThan(8.1);
  });
});
