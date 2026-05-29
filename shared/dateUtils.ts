/**
 * Shared, timezone-safe date helpers for plan scheduling. Used by BOTH the
 * client (form prefill + the live "N-week plan" readout) and the server / Zod
 * schema (deriving and validating a plan's length from its start/end dates).
 *
 * All span math is done in UTC on `YYYY-MM-DD` date-only strings. We never
 * subtract two local `Date` objects: a viewer whose timezone crosses a DST
 * boundary between the two dates would otherwise see a 23h/25h "day" and a
 * wrong week count. Constructing both endpoints at UTC midnight makes every
 * difference an exact multiple of one day.
 */

export const MIN_PLAN_WEEKS = 1;
export const MAX_PLAN_WEEKS = 24;

const MS_PER_DAY = 86_400_000;

/** Parse a strict `YYYY-MM-DD` string to a UTC-midnight epoch (ms). */
function toUtcEpoch(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * Whole-day span from `startDate` to `endDate` (both `YYYY-MM-DD`), computed in
 * UTC so it is DST-safe. Positive when `endDate` is after `startDate`; may be
 * zero or negative.
 */
export function dayDiff(startDate: string, endDate: string): number {
  return Math.round((toUtcEpoch(endDate) - toUtcEpoch(startDate)) / MS_PER_DAY);
}

/**
 * Plan length in weeks derived from a start → end span, clamped to
 * `[MIN_PLAN_WEEKS, MAX_PLAN_WEEKS]`.
 *
 * Uses `round(days / 7)` (NOT `ceil`): a span of exactly 8 weeks (56 days) must
 * read as 8 weeks, preserving the historical default. The clamp is
 * defense-in-depth for the DB write and any non-UI caller — the form and the
 * Zod schema reject an out-of-range span up front rather than silently clamping.
 */
export function computePlanWeeks(startDate: string, endDate: string): number {
  const weeks = Math.round(dayDiff(startDate, endDate) / 7);
  return Math.min(MAX_PLAN_WEEKS, Math.max(MIN_PLAN_WEEKS, weeks));
}

/** Add `days` whole days to a `YYYY-MM-DD` string, returning `YYYY-MM-DD` (UTC math). */
export function addDaysToISODate(date: string, days: number): string {
  const next = new Date(toUtcEpoch(date) + days * MS_PER_DAY);
  const year = next.getUTCFullYear();
  const month = String(next.getUTCMonth() + 1).padStart(2, "0");
  const day = String(next.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
