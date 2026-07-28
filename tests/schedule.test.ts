import { describe, it, expect } from "vitest";
import { localHourAndDow } from "@/lib/time";
import { stageDue, STAGE_HOUR } from "@/cron/window";
import { DateTime } from "luxon";

const PT = "America/Los_Angeles";
const at = (h: number, m = 0, day = 27) =>
  DateTime.fromObject({ year: 2026, month: 7, day, hour: h, minute: m }, { zone: PT }).toJSDate();

/** The daily-digest half of dueKinds: due from the scheduled time, for a while
 *  after, so a missed cron tick delays the post instead of losing the day. */
function dailyDue(now: Date, opts?: { alreadyPosted?: boolean; catchUpHours?: number }) {
  const DAILY_HOUR = 17;
  const AFTER_MINUTE = 28;
  const catchUp = opts?.catchUpHours ?? 4;
  const { hour, minute } = localHourAndDow(now, PT);
  const nowMinutes = hour * 60 + minute;
  const from = DAILY_HOUR * 60 + AFTER_MINUTE;
  const until = Math.min(from + catchUp * 60, 24 * 60 - 1);
  if (nowMinutes < from || nowMinutes > until) return false;
  return !opts?.alreadyPosted;
}

describe("daily digest scheduling", () => {
  it("is not due before the scheduled time", () => {
    expect(dailyDue(at(17, 0))).toBe(false);
    expect(dailyDue(at(17, 27))).toBe(false);
    expect(dailyDue(at(9, 0))).toBe(false);
  });

  it("is due at the scheduled time", () => {
    expect(dailyDue(at(17, 30))).toBe(true);
  });

  it("stays due after a missed tick — the real 2026-07-27 failure", () => {
    // No cron tick landed in the 17:00 hour that day, so an exact-hour match
    // skipped the digest entirely. Later ticks must still post it.
    expect(dailyDue(at(18, 0))).toBe(true);
    expect(dailyDue(at(19, 15))).toBe(true);
    expect(dailyDue(at(21, 0))).toBe(true);
  });

  it("stops catching up once the window closes, and never crosses midnight", () => {
    expect(dailyDue(at(22, 0))).toBe(false); // 17:28 + 4h
    expect(dailyDue(at(23, 59))).toBe(false);
    expect(dailyDue(at(0, 30, 28))).toBe(false); // next day, before the hour
  });

  it("does not repost once the day's digest has gone out", () => {
    expect(dailyDue(at(18, 0), { alreadyPosted: true })).toBe(false);
    expect(dailyDue(at(19, 30), { alreadyPosted: true })).toBe(false);
  });
});

describe("pipeline stage gating", () => {
  const req = new Request("https://example.com/api/cron/x");

  it("admits a stage only in its own local hour", () => {
    expect(stageDue(req, STAGE_HOUR.ingest, at(15, 0))).toBe(true);
    expect(stageDue(req, STAGE_HOUR.ingest, at(16, 0))).toBe(false);
    expect(stageDue(req, STAGE_HOUR.dedup, at(16, 0))).toBe(true);
    expect(stageDue(req, STAGE_HOUR.score, at(17, 0))).toBe(true);
    expect(stageDue(req, STAGE_HOUR.score, at(15, 0))).toBe(false);
  });

  it("runs the stages in order: ingest -> dedup/research -> score", () => {
    expect(STAGE_HOUR.ingest).toBeLessThan(STAGE_HOUR.dedup);
    expect(STAGE_HOUR.dedup).toBeLessThanOrEqual(STAGE_HOUR.research);
    expect(STAGE_HOUR.research).toBeLessThan(STAGE_HOUR.score);
  });

  it("?force=1 overrides the hour gate for manual runs", () => {
    const forced = new Request("https://example.com/api/cron/x?force=1");
    expect(stageDue(forced, STAGE_HOUR.ingest, at(3, 0))).toBe(true);
  });
});
