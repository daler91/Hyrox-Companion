/**
 * Timezone-aware date helpers used by the email scheduler and anywhere else
 * "what calendar day is it for THIS user" matters more than UTC. The fitness
 * domain is full of these: "this week's workouts", "yesterday's missed
 * session", "Monday morning summary email" — all should align with the
 * athlete's wall clock, not the server's.
 *
 * All helpers take an IANA timezone name (e.g. "America/Chicago",
 * "Europe/London"). The `isValidTimezone` guard at the bottom is the one
 * used by every untrusted call site (the preferences PATCH endpoint).
 */

/** Sunday → 0, Monday → 1, ..., Saturday → 6 — matching Date.getDay(). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const WEEKDAY_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const YMD_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function getWeekdayFormatter(tz: string): Intl.DateTimeFormat {
  let formatter = WEEKDAY_FORMATTERS.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    WEEKDAY_FORMATTERS.set(tz, formatter);
  }
  return formatter;
}

function getYmdFormatter(tz: string): Intl.DateTimeFormat {
  let formatter = YMD_FORMATTERS.get(tz);
  if (!formatter) {
    // en-CA emits "YYYY-MM-DD" which we can use directly without parsing.
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    YMD_FORMATTERS.set(tz, formatter);
  }
  return formatter;
}

const WEEKDAY_INDEX: Record<string, DayOfWeek> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Return the day-of-week (Sun=0..Sat=6) for `instant` as seen in `tz`. A
 * `now` of 2026-05-31T23:30:00Z evaluates to Monday (1) in "Australia/Sydney"
 * (which is already 09:30 Monday) and Sunday (0) in "UTC".
 */
export function getLocalDayOfWeek(instant: Date, tz: string): DayOfWeek {
  const label = getWeekdayFormatter(tz).format(instant);
  const day = WEEKDAY_INDEX[label];
  if (day === undefined) {
    throw new Error(`Unexpected weekday label "${label}" from Intl formatter for tz "${tz}"`);
  }
  return day;
}

/**
 * Return the local calendar date for `instant` as seen in `tz`, formatted
 * "YYYY-MM-DD". The result is suitable for passing to date-typed SQL columns
 * directly and matches the shape `toDateStr` returns for UTC inputs.
 */
export function getLocalDateStr(instant: Date, tz: string): string {
  return getYmdFormatter(tz).format(instant);
}

/**
 * Add `days` (may be negative) to a YYYY-MM-DD string in date-only space —
 * no timezone interpretation needed because the inputs are already calendar
 * dates. DST is irrelevant because a calendar day is a calendar day.
 *
 * Implemented via `Date.UTC` arithmetic to avoid the local-time DST hour
 * shifts that bite `new Date(2024, 2, 10).setDate(...)`.
 */
export function addDaysLocal(dateStr: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`Expected YYYY-MM-DD, got "${dateStr}"`);
  }
  const [, yyyy, mm, dd] = match;
  const utcMs = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)) + days * 24 * 60 * 60 * 1000;
  const next = new Date(utcMs);
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Cheap IANA validation. We rely on the platform to know what timezones it
 * supports — `Intl.DateTimeFormat` throws `RangeError` for unknown names,
 * which is what we want a route-layer validator to surface as a 400.
 *
 * Empty string and non-string inputs are rejected as well.
 */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
