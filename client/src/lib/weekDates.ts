import { addDaysToISODate } from "@shared/dateUtils";

import { getTodayString } from "./dateUtils";

/**
 * Monday-anchored week helpers for the weekly review, in date-only space.
 *
 * The client mirror of `getWeekRangeForDate` in
 * `server/services/weeklyProgress.ts`, and it must agree with it: the server
 * resolves the week in the athlete's stored timezone while the browser knows
 * only its own, so these compute the *request* (which week to ask for) and the
 * server's answer is what gets rendered.
 *
 * All arithmetic goes through `addDaysToISODate`, which does UTC calendar math
 * on the string — a local `Date` walked across a DST boundary can land an hour
 * short and roll back a day.
 */

/** The Monday on or before `dateStr`. Sunday anchors back, per ISO-8601. */
export function mondayOf(dateStr: string): string {
  // Parsed at UTC midnight purely to read the weekday; a calendar date falls on
  // the same weekday in every timezone, so no local parse is needed here.
  const dayOfWeek = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return addDaysToISODate(dateStr, mondayOffset);
}

/** Today as YYYY-MM-DD in the browser's local calendar. */
export function todayLocalDateStr(): string {
  return getTodayString();
}

export { addDaysToISODate as addDays } from "@shared/dateUtils";

/** The Monday of the most recently completed week, as of the browser's today. */
export function lastCompletedWeekStart(): string {
  return mondayOf(addDaysToISODate(todayLocalDateStr(), -7));
}

/**
 * "Jun 1–7, 2026", collapsing the parts both ends share.
 *
 * Assembled from parts rather than handed to `toLocaleDateString` as a range,
 * because the pieces a locale drops and the order it puts them in both vary —
 * and a header that reads "1 – Jun 7, 2026" in one runtime and "1 – 7 Jun 2026"
 * in another is not a format, it is a coin flip. `en-US` matches the rest of
 * the app's date rendering (see `MafTrendTab`).
 */
export function formatWeekRange(weekStart: string, weekEnd: string): string {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(`${weekEnd}T00:00:00`);
  const month = (date: Date) => date.toLocaleDateString("en-US", { month: "short" });

  if (start.getFullYear() !== end.getFullYear()) {
    return `${month(start)} ${start.getDate()}, ${start.getFullYear()} – ${month(end)} ${end.getDate()}, ${end.getFullYear()}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${month(start)} ${start.getDate()} – ${month(end)} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${month(start)} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
}

/** "Mon, Jun 8" for a single day inside the week. */
export function formatDayLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
