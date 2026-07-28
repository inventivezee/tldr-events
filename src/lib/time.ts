// Timezone handling (PRD §6, §9.4, Appendix B). UTC in the store; localize only
// at display. IANA data via luxon → DST is automatic, no fixed offsets anywhere.
import { DateTime } from "luxon";

const DEFAULT_TZ = "America/Los_Angeles";

/**
 * Normalize a source timestamp to a UTC Date.
 * - ISO strings with an offset/Z are honored as-is.
 * - Naive strings (no offset) are localized to `sourceTz` first, then converted.
 */
export function parseToUtc(input: string | number | Date, sourceTz?: string): Date {
  // Playwright's page.evaluate can hand back real Date objects; numbers are epoch ms.
  if (input instanceof Date) return new Date(input.getTime());
  if (typeof input === "number") return new Date(input);
  const tz = sourceTz || DEFAULT_TZ;
  // Try ISO first (handles trailing Z and explicit offsets).
  let dt = DateTime.fromISO(input, { setZone: true });
  if (!dt.isValid) {
    // Fall back to RFC2822 / SQL / JS Date parsing, treated as naive-in-source-tz.
    dt = DateTime.fromRFC2822(input, { zone: tz });
  }
  if (!dt.isValid) {
    const ms = Date.parse(input);
    if (!Number.isNaN(ms)) return wallClockIn(new Date(ms), tz);
    throw new Error(`Unparseable datetime: ${JSON.stringify(input)}`);
  }
  // If the parsed value carried no explicit zone, luxon assumed local machine tz;
  // reinterpret those wall-clock digits as being in the source tz.
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(input.trim())) {
    dt = DateTime.fromISO(input, { zone: tz });
    if (!dt.isValid) return wallClockIn(new Date(input), tz);
  }
  return dt.toUTC().toJSDate();
}

/**
 * Reinterpret a Date's WALL-CLOCK digits as being in `tz`.
 *
 * `Date.parse`/`new Date(str)` resolve a zone-less string against the MACHINE's
 * timezone, so the same scraped string ("Jul 30, 2026 11:30 AM") yields a
 * different instant on a laptop in Pacific than on Vercel, which runs in UTC —
 * events came out 7 hours early in production only. Reading the components back
 * with the local getters recovers exactly the digits that were in the string,
 * and rebuilding them in `tz` makes the result machine-independent.
 */
function wallClockIn(d: Date, tz: string): Date {
  if (Number.isNaN(d.getTime())) throw new Error("Unparseable datetime");
  return DateTime.fromObject(
    {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
    },
    { zone: tz },
  )
    .toUTC()
    .toJSDate();
}

/**
 * Best-effort parse of a human-readable date/time string (scraped cards),
 * interpreted in `sourceTz`. Tries several common formats, then Date.parse.
 * Returns null when nothing parses (caller should skip the event).
 */
export function parseLoose(input: string, sourceTz?: string): Date | null {
  const tz = sourceTz || DEFAULT_TZ;
  const text = input.replace(/\s+/g, " ").replace(/ /g, " ").trim();
  if (!text) return null;

  // ISO / offset first.
  const iso = DateTime.fromISO(text, { setZone: true });
  if (iso.isValid) return iso.toUTC().toJSDate();

  const year = DateTime.now().setZone(tz).year;
  const formats = [
    "ccc, LLL d, yyyy, h:mm a",
    "ccc, LLL d, h:mm a",
    "cccc, LLLL d, yyyy, h:mm a",
    "cccc, LLLL d h:mm a",
    "LLL d, yyyy, h:mm a",
    "LLL d, h:mm a",
    "LLLL d, h:mm a",
    "LLL d yyyy h:mm a",
    "M/d/yyyy h:mm a",
    "M/d/yyyy",
    "ccc, LLL d",
    "LLL d, yyyy",
    "LLL d",
  ];
  for (const fmt of formats) {
    let dt = DateTime.fromFormat(text, fmt, { zone: tz, locale: "en-US" });
    if (dt.isValid) {
      // Formats without a year default to 1970 in luxon → bump to this year.
      if (dt.year < 2000) dt = dt.set({ year });
      return dt.toUTC().toJSDate();
    }
  }

  const ms = Date.parse(text);
  if (!Number.isNaN(ms)) return new Date(ms);
  return null;
}
export function fmtLocalTime(utc: Date, tz: string): string {
  return DateTime.fromJSDate(utc, { zone: "utc" })
    .setZone(tz)
    .toFormat("h:mma");
}

/** e.g. "Tue, Jul 22". */
export function fmtLocalDate(utc: Date, tz: string): string {
  return DateTime.fromJSDate(utc, { zone: "utc" })
    .setZone(tz)
    .toFormat("ccc, LLL d");
}

/** e.g. "Tue, Jul 22 · 7:00PM". */
export function fmtLocalDateTime(utc: Date, tz: string): string {
  return `${fmtLocalDate(utc, tz)} · ${fmtLocalTime(utc, tz)}`;
}

/** Local calendar date "yyyy-MM-dd" in region tz — used for dedup keys (§10). */
export function startLocalDate(utc: Date, tz: string): string {
  return DateTime.fromJSDate(utc, { zone: "utc" }).setZone(tz).toFormat("yyyy-MM-dd");
}

export interface UtcWindow {
  start: Date;
  end: Date;
}

/** Weekly digest window: the next 7 local days, today .. +6 (PRD §12.1).
 *  Ends at +6 end-of-day so "next week" (+7 .. +13) does not overlap. */
export function weeklyWindow(now: Date, tz: string): UtcWindow {
  const local = DateTime.fromJSDate(now, { zone: "utc" }).setZone(tz);
  const start = local.startOf("day");
  const end = local.plus({ days: 6 }).endOf("day");
  return { start: start.toUTC().toJSDate(), end: end.toUTC().toJSDate() };
}

/** A single local calendar day at `offsetDays` from today (0=today, 1=tomorrow). */
export function dayWindow(now: Date, tz: string, offsetDays = 0): UtcWindow {
  const local = DateTime.fromJSDate(now, { zone: "utc" }).setZone(tz).plus({ days: offsetDays });
  return {
    start: local.startOf("day").toUTC().toJSDate(),
    end: local.endOf("day").toUTC().toJSDate(),
  };
}

/** The local calendar day named by an ISO date ("2026-07-30"), as a UTC window. */
export function windowForLocalDate(dateISO: string, tz: string): UtcWindow {
  const d = DateTime.fromISO(dateISO, { zone: tz });
  return {
    start: d.startOf("day").toUTC().toJSDate(),
    end: d.endOf("day").toUTC().toJSDate(),
  };
}

/** Whole days from today to the given local date (0 = today). Null if unparseable. */
export function daysUntilLocalDate(dateISO: string, tz: string): number | null {
  const target = DateTime.fromISO(dateISO, { zone: tz }).startOf("day");
  if (!target.isValid) return null;
  return Math.round(target.diff(DateTime.now().setZone(tz).startOf("day"), "days").days);
}

/** This CALENDAR week: today → end of the current week (Sunday; weeks start Monday).
 *  Starts at today (not Monday) so past days this week aren't shown. */
export function thisWeekWindow(now: Date, tz: string): UtcWindow {
  const local = DateTime.fromJSDate(now, { zone: "utc" }).setZone(tz);
  return {
    start: local.startOf("day").toUTC().toJSDate(),
    end: local.endOf("week").toUTC().toJSDate(),
  };
}

/** Next CALENDAR week: next Monday → next Sunday. */
export function nextWeekWindow(now: Date, tz: string): UtcWindow {
  const local = DateTime.fromJSDate(now, { zone: "utc" }).setZone(tz).plus({ weeks: 1 });
  return {
    start: local.startOf("week").toUTC().toJSDate(),
    end: local.endOf("week").toUTC().toJSDate(),
  };
}

/** Forward scoring window: now → +N local days (candidate set for scoring). */
export function forwardWindow(now: Date, tz: string, days = 21): UtcWindow {
  const local = DateTime.fromJSDate(now, { zone: "utc" }).setZone(tz);
  const start = local.minus({ hours: 6 }); // small grace for in-progress events
  const end = local.plus({ days }).endOf("day");
  return { start: start.toUTC().toJSDate(), end: end.toUTC().toJSDate() };
}

/** Local hour-of-day (0–23) and ISO weekday (1=Mon..7=Sun) for scheduling. */
export function localHourAndDow(
  now: Date,
  tz: string,
): { hour: number; minute: number; dow: number } {
  const local = DateTime.fromJSDate(now, { zone: "utc" }).setZone(tz);
  return { hour: local.hour, minute: local.minute, dow: local.weekday };
}
