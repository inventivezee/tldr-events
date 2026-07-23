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
    if (!Number.isNaN(ms)) return new Date(ms);
    throw new Error(`Unparseable datetime: ${JSON.stringify(input)}`);
  }
  // If the parsed value carried no explicit zone, luxon assumed local machine tz;
  // reinterpret those wall-clock digits as being in the source tz.
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(input.trim())) {
    dt = DateTime.fromISO(input, { zone: tz });
    if (!dt.isValid) dt = DateTime.fromJSDate(new Date(input), { zone: tz });
  }
  return dt.toUTC().toJSDate();
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

/** Daily digest window: today + tomorrow, local calendar days (PRD §12.3). */
export function dailyWindow(now: Date, tz: string): UtcWindow {
  const local = DateTime.fromJSDate(now, { zone: "utc" }).setZone(tz);
  const start = local.startOf("day");
  const end = local.plus({ days: 1 }).endOf("day");
  return { start: start.toUTC().toJSDate(), end: end.toUTC().toJSDate() };
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

/** Next week: +7 .. +13 local days (contiguous with, not overlapping, this week). */
export function nextWeekWindow(now: Date, tz: string): UtcWindow {
  const local = DateTime.fromJSDate(now, { zone: "utc" }).setZone(tz);
  return {
    start: local.plus({ days: 7 }).startOf("day").toUTC().toJSDate(),
    end: local.plus({ days: 13 }).endOf("day").toUTC().toJSDate(),
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
export function localHourAndDow(now: Date, tz: string): { hour: number; dow: number } {
  const local = DateTime.fromJSDate(now, { zone: "utc" }).setZone(tz);
  return { hour: local.hour, dow: local.weekday };
}
