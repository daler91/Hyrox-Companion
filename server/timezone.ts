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

import { addDaysToISODate } from "@shared/dateUtils";

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
 * directly and matches the shape `toIsoDateUtc` (shared/dateUtils) returns
 * for UTC inputs.
 */
export function getLocalDateStr(instant: Date, tz: string): string {
  return getYmdFormatter(tz).format(instant);
}

const HOUR_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function getHourFormatter(tz: string): Intl.DateTimeFormat {
  let formatter = HOUR_FORMATTERS.get(tz);
  if (!formatter) {
    // hourCycle "h23" guarantees a 00-23 range (midnight = "00"), avoiding the
    // "24" that hour12:false emits in some locales.
    formatter = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" });
    HOUR_FORMATTERS.set(tz, formatter);
  }
  return formatter;
}

/**
 * Return the local hour (0-23) for `instant` as seen in `tz`. Used by the
 * analytics recompute cron to fire each user's job once per day at their local
 * midnight (hour 0) — the same "fixed UTC tick, gate per local time" approach
 * the email scheduler uses for weekly summaries. A sub-hour UTC offset (e.g.
 * India +5:30, Nepal +5:45) still resolves to hour 0 on exactly one of the
 * hourly UTC ticks, so every user is covered once per day.
 */
export function getLocalHour(instant: Date, tz: string): number {
  const label = getHourFormatter(tz).format(instant);
  const hour = Number(label);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`Unexpected hour label "${label}" from Intl formatter for tz "${tz}"`);
  }
  return hour;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Whether `hour` (0-23, athlete-local) falls due on the hourly UTC tick at
 * `instant`: the tick inside that local hour, or, when a spring-forward gap
 * skipped the hour on today's local date, the first tick after the gap.
 *
 * A bare `getLocalHour(...) === hour` never matches an hour that does not
 * exist, so a 02:00 choice in New York is silently dropped on the March
 * Sunday, and a midnight job in Santiago, Beirut or Havana (which jump from
 * 23:59 to 01:00) misses that day. The gap shows up as the previous tick's
 * local hour being two or more behind this one's. C24
 * (CODEBASE_ANALYSIS_2026-10-03)
 *
 * Still at most one tick per local date for a skipped hour, since only the
 * tick straight after the gap sees it. An hour the gap took from the PREVIOUS
 * date (a jump from 23:00 into the new day) is not carried over, so nothing
 * lands on the next day, where a weekday gate would read it differently.
 * Hourly ticks are assumed, as the email and analytics crons run them.
 */
export function isLocalHourDue(instant: Date, tz: string, hour: number): boolean {
  const localHour = getLocalHour(instant, tz);
  if (localHour === hour) return true;
  if (hour >= localHour) return false;
  const previousHour = getLocalHour(new Date(instant.getTime() - HOUR_MS), tz);
  const gap = (localHour - previousHour + 24) % 24;
  if (gap < 2) return false;
  // A gap that wrapped through midnight skipped every earlier hour of today;
  // otherwise only the hours after the previous tick's.
  return previousHour > localHour || hour > previousHour;
}

/**
 * Parse a YYYY-MM-DD calendar string to the UTC-midnight instant that stands
 * for it. Date-only space has no timezone, so UTC midnight is just the anchor
 * every helper below shares — never treat the result as a wall-clock time.
 */
function parseDateStrToUtcMs(dateStr: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`Expected YYYY-MM-DD, got "${dateStr}"`);
  }
  const [, yyyy, mm, dd] = match;
  return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd));
}

/**
 * Add `days` (may be negative) to a YYYY-MM-DD string in date-only space —
 * no timezone interpretation needed because the inputs are already calendar
 * dates. DST is irrelevant because a calendar day is a calendar day.
 *
 * `addDaysToISODate` from shared/dateUtils.ts with a shape check in front: it
 * throws on anything but YYYY-MM-DD, which the shared helper does not. The
 * arithmetic was a copy of the shared helper's (S-addDays, REFACTORING_REVIEW
 * 2026-09-23).
 */
export function addDaysLocal(dateStr: string, days: number): string {
  parseDateStrToUtcMs(dateStr);
  return addDaysToISODate(dateStr, days);
}

/**
 * Day-of-week (Sun=0..Sat=6) for a YYYY-MM-DD calendar string.
 *
 * Deliberately takes no timezone: a calendar date falls on the same weekday
 * everywhere, and 2026-08-10 is a Monday in Sydney and in Honolulu alike. This
 * is the date-only counterpart of {@link getLocalDayOfWeek}, which answers the
 * different question "what weekday is it *right now* for this athlete".
 */
export function getDayOfWeekForDateStr(dateStr: string): DayOfWeek {
  return new Date(parseDateStrToUtcMs(dateStr)).getUTCDay() as DayOfWeek;
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

/**
 * A stored timezone, or "UTC" when it is absent or the platform no longer
 * recognises it (see `getLocalDateStrSafe` for how that happens). For routes
 * that pass one zone to several helpers (`getLocalDateStr`, `getLocalHour`,
 * `localTimeOnDate`), each of which would throw a RangeError on a bad name.
 */
export function usableTimezone(tz: string | null | undefined): string {
  return isValidTimezone(tz) ? tz : "UTC";
}

/**
 * Like `getLocalDateStr`, but never throws. A stored timezone can become
 * unrecognisable after it was written — a name dropped from the platform's
 * tzdata, or a row that predates route-layer validation — and `Intl` answers
 * that with a RangeError. Reads that merely need "what day is it for this
 * athlete" must not 500 over it, so an unusable (or absent) zone degrades to
 * UTC, which is exactly the behaviour those call sites had before they became
 * timezone-aware.
 */
export function getLocalDateStrSafe(instant: Date, tz: string | null | undefined): string {
  if (!tz) return getLocalDateStr(instant, "UTC");
  try {
    return getLocalDateStr(instant, tz);
  } catch {
    return getLocalDateStr(instant, "UTC");
  }
}

const OFFSET_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function getOffsetFormatter(tz: string): Intl.DateTimeFormat {
  let formatter = OFFSET_FORMATTERS.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    OFFSET_FORMATTERS.set(tz, formatter);
  }
  return formatter;
}

/** How far `tz`'s wall clock is ahead of UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: number, tz: string): number {
  const parts = getOffsetFormatter(tz).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wallClockAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which `tz`'s wall clock reads `hour`:00 on the calendar date
 * `dateStr`: local noon by default. The inverse of {@link getLocalDateStr} for
 * a time of day, for a write that has a date but no moment of its own (a
 * repeated nutrition day). Noon is safe from DST changes, which happen at
 * night; an unusable zone falls back to UTC, as getLocalDateStrSafe does.
 */
export function localTimeOnDate(dateStr: string, tz: string | null | undefined, hour = 12): Date {
  const wallClockAsUtc = parseDateStrToUtcMs(dateStr) + hour * 60 * 60 * 1000;
  if (!tz || !isValidTimezone(tz)) return new Date(wallClockAsUtc);
  const firstGuess = wallClockAsUtc - zoneOffsetMs(wallClockAsUtc, tz);
  // A second pass settles the offset when the first guess landed on the
  // other side of a DST change from the wall-clock time.
  return new Date(wallClockAsUtc - zoneOffsetMs(firstGuess, tz));
}
