import { addDaysLocal, getDayOfWeekForDateStr, getLocalDateStrSafe } from "../timezone";
import { toDateStr } from "../types";

export interface MondayWeekBoundaries {
  thisMondayStr: string;
  lastMondayStr: string;
}

/**
 * The Monday that opens this week and the one before it, in the ATHLETE's
 * calendar.
 *
 * `userTimezone` used to be unavailable here, so both callers got UTC weeks
 * while the weekly review used athlete-local ones — a UTC−8 athlete's weekly
 * count reset on Sunday afternoon and the two screens disagreed about which
 * week a session belonged to (audit H11). Omitting the timezone still yields
 * the old UTC behaviour, for callers that genuinely have no athlete.
 */
export function getMondayWeekBoundaries(
  todayInput: Date = new Date(),
  userTimezone?: string | null,
): MondayWeekBoundaries {
  // The athlete's calendar date when we know their zone; UTC otherwise.
  const dateStr = userTimezone ? getLocalDateStrSafe(todayInput, userTimezone) : toDateStr(todayInput);

  // Parse it explicitly as a UTC date to prevent local timezone skew
  // new Date(dateStr) automatically parses "YYYY-MM-DD" as UTC midnight,
  // but subsequent Date methods like getDay(), getDate() will use the local timezone.
  // Using getUTCDay(), getUTCDate() ensures we stay in UTC.
  const today = new Date(dateStr);

  const dayOfWeek = today.getUTCDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const thisMonday = new Date(today);
  thisMonday.setUTCDate(today.getUTCDate() + mondayOffset);

  const lastMonday = new Date(thisMonday);
  lastMonday.setUTCDate(thisMonday.getUTCDate() - 7);

  return {
    thisMondayStr: toDateStr(thisMonday),
    lastMondayStr: toDateStr(lastMonday),
  };
}

/** An inclusive Monday→Sunday calendar week, both ends as YYYY-MM-DD. */
export interface LocalWeekRange {
  /** Monday that opens the week. */
  weekStart: string;
  /** Sunday that closes it — inclusive, and safe to use as a SQL upper bound. */
  weekEnd: string;
}

/** Both weeks an athlete-facing weekly surface needs at once. */
export interface LocalMondayWeekBoundaries {
  /** The week containing "today" in the athlete's timezone. */
  current: LocalWeekRange;
  /** The week before it — the most recently *completed* week. */
  previous: LocalWeekRange;
}

/**
 * The Monday→Sunday week that contains `dateStr`.
 *
 * Pure date-only math, so it is DST-proof by construction: the input is a
 * calendar date, the output is two calendar dates, and no wall-clock hour is
 * ever consulted. Sunday anchors *back* to its Monday rather than opening a new
 * week, matching {@link getMondayWeekBoundaries} and ISO-8601.
 */
export function getWeekRangeForDate(dateStr: string): LocalWeekRange {
  const dayOfWeek = getDayOfWeekForDateStr(dateStr);
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = addDaysLocal(dateStr, mondayOffset);
  return { weekStart, weekEnd: addDaysLocal(weekStart, 6) };
}

/**
 * Monday-anchored week boundaries in the *athlete's* timezone.
 *
 * The counterpart of {@link getMondayWeekBoundaries}, which anchors to UTC and
 * powers the training-overview charts. Athlete-facing weekly surfaces should
 * use this one: a Sydney athlete's Monday starts eleven hours before a UTC
 * Monday does, and a weekly summary that disagrees with the athlete's own
 * calendar is worse than one that disagrees with a chart.
 *
 * An unusable timezone degrades to UTC via {@link getLocalDateStrSafe} rather
 * than throwing — a stale `users.userTimezone` must not 500 a read.
 */
export function getLocalMondayWeekBoundaries(now: Date, tz: string): LocalMondayWeekBoundaries {
  const current = getWeekRangeForDate(getLocalDateStrSafe(now, tz));
  return { current, previous: getWeekRangeForDate(addDaysLocal(current.weekStart, -7)) };
}
