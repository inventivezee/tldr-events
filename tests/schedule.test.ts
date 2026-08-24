import { describe, it, expect } from "vitest";
import { localHourAndDow } from "@/lib/time";
import { STAGES, PIPELINE_START_HOUR } from "@/cron/pipeline";
import { dayHeader, rangeHeader } from "@/telegram/bot";
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

describe("pipeline stages", () => {
  // One cron drives the whole chain (Vercel dropped ticks when several jobs
  // shared a trigger minute), so what matters now is the ORDER and that each
  // stage is attempted once a day — not per-stage cron timing.
  it("runs in dependency order", () => {
    expect(STAGES.map((s) => s.name)).toEqual([
      "ingest",
      "ingest_extra",
      "dedup",
      "research",
      "score",
    ]);
  });

  it("gathers before the digest goes out", () => {
    // Digest is due from 17:28; the chain must have time to finish first.
    expect(PIPELINE_START_HOUR).toBeLessThan(17);
  });

  it("gives every stage its own lock name", () => {
    const names = STAGES.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

/** Weekday shortcuts: "thu" resolves to the NEXT Thursday, today included. */
function resolveWeekday(targetWeekday: number, todayWeekday: number) {
  return (targetWeekday - todayWeekday + 7) % 7;
}

describe("weekday commands", () => {
  it("resolves to today when the day matches", () => {
    expect(resolveWeekday(4, 4)).toBe(0); // Thursday, on a Thursday
  });

  it("looks forward within the week, never backwards", () => {
    expect(resolveWeekday(4, 1)).toBe(3); // Mon -> Thu
    expect(resolveWeekday(1, 4)).toBe(4); // Thu -> next Mon (not -3)
    expect(resolveWeekday(7, 6)).toBe(1); // Sat -> Sun
    for (let today = 1; today <= 7; today++)
      for (let target = 1; target <= 7; target++) {
        const d = resolveWeekday(target, today);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(6);
      }
  });
});

describe("bot reply headers carry the actual date", () => {
  // A relative word on its own ("Today") is ambiguous when the reply is read
  // later, or scrolled back to. Every header names the date it covers.
  it("puts the date next to Today / Tomorrow", () => {
    const today = DateTime.now().setZone(PT);
    expect(dayHeader("☀️", "Today", PT, 0)).toBe(
      `☀️ <b>Today — ${today.toFormat("ccc LLL d")}</b>`,
    );
    expect(dayHeader("🌅", "Tomorrow", PT, 1)).toBe(
      `🌅 <b>Tomorrow — ${today.plus({ days: 1 }).toFormat("ccc LLL d")}</b>`,
    );
  });

  it("names a weekday's own date", () => {
    const h = dayHeader("🗓️", "Thursday", PT, 3);
    expect(h).toContain("Thursday — ");
    expect(h).toMatch(/[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}/); // "Thu Jul 30"
  });

  it("spans a date range for week views, including across a month boundary", () => {
    const sameMonth = {
      start: DateTime.fromISO("2026-07-06", { zone: PT }).toUTC().toJSDate(),
      end: DateTime.fromISO("2026-07-12T23:59", { zone: PT }).toUTC().toJSDate(),
    };
    expect(rangeHeader("🗓️", "This Week", sameMonth, PT)).toBe(
      "🗓️ <b>This Week — Jul 6–12</b>",
    );
    const crossMonth = {
      start: DateTime.fromISO("2026-07-27", { zone: PT }).toUTC().toJSDate(),
      end: DateTime.fromISO("2026-08-02T23:59", { zone: PT }).toUTC().toJSDate(),
    };
    expect(rangeHeader("🗓️", "This Week", crossMonth, PT)).toBe(
      "🗓️ <b>This Week — Jul 27–Aug 2</b>",
    );
  });
});

describe("pipeline stage completion", () => {
  // Consolidating six crons into one made every stage run ONCE a day. Scoring is
  // batch-limited per run, so that quietly capped it at one batch and left a
  // permanent backlog — 327 of 377 events in the window had no score, i.e. were
  // invisible to both the site and the digest. Scoring is a queue, not an event.
  it("marks scoring as a queue-draining stage, and the rest as once-daily", () => {
    const score = STAGES.find((s) => s.name === "score");
    expect(score?.hasBacklog).toBeTypeOf("function");
    for (const s of STAGES.filter((s) => s.name !== "score")) {
      expect(s.hasBacklog, `${s.name} should be once-daily`).toBeUndefined();
    }
  });
});

describe("a stuck queue stage must not take the digest off the air", () => {
  // 2026-08-23: the provider switch left every scoring call failing. `score`
  // still reported a backlog, so it sat at the head of the pending list on every
  // tick and runPipelineTick returned before ever reaching the digest. The daily
  // post silently stopped. The digest is the product — it cannot depend on
  // scoring being healthy.
  const score = STAGES.find((s) => s.name === "score")!;

  it("treats a zero-scored run as no progress", () => {
    expect(score.progressed).toBeTypeOf("function");
    expect(score.progressed!([{ feedId: "bay_founder", candidates: 382, scored: 0 }])).toBe(false);
  });

  it("treats a run that scored something as progress", () => {
    expect(score.progressed!([{ feedId: "bay_founder", candidates: 382, scored: 12 }])).toBe(true);
  });

  it("counts progress if any feed moved", () => {
    expect(score.progressed!([{ scored: 0 }, { scored: 3 }])).toBe(true);
  });

  it("survives a malformed or empty result rather than claiming progress", () => {
    expect(score.progressed!(undefined)).toBe(false);
    expect(score.progressed!([])).toBe(false);
    expect(score.progressed!([{}])).toBe(false);
  });

  it("only applies to queue stages — a once-daily stage has no progress notion", () => {
    for (const s of STAGES.filter((s) => !s.hasBacklog)) {
      expect(s.progressed, `${s.name}`).toBeUndefined();
    }
  });
});
