import { toIsoDateUtc } from "@shared/dateUtils";

import { addDaysLocal, getDayOfWeekForDateStr, getLocalDateStrSafe } from "../timezone";

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
  const dateStr = userTimezone ? getLocalDateStrSafe(todayInput, userTimezone) : toIsoDateUtc(todayInput);
  const thisMondayStr = utcMondayOf(dateStr);

  const lastMonday = new Date(`${thisMondayStr}T00:00:00Z`);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);

  return {
    thisMondayStr,
    lastMondayStr: toIsoDateUtc(lastMonday),
  };
}

/**
 * The Monday on or before `dateStr` (YYYY-MM-DD). Parsed at UTC midnight, and
 * read and written with the UTC accessors: getDay()/setDate() are local-time
 * and would shift the week under any server timezone that is not UTC. Shared
 * by getMondayWeekBoundaries and the training overview's weekly buckets
 * (`getMonday` in analyticsService.ts), which each computed it
 * (S-mondayOfWeek, REFACTORING_REVIEW 2026-09-23).
 */
export function utcMondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split("T")[0];
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
 * The counterpart of {@link getMondayWeekBoundaries}, which returns only the
 * two Monday dates (every caller now passes the athlete's timezone; without
 * one it falls back to UTC). This one returns full Monday-to-Sunday ranges for
 * this week and last, for the weekly surfaces that need both ends: a Sydney
 * athlete's Monday starts eleven hours before a UTC Monday does, and a weekly
 * summary that disagrees with the athlete's own calendar is wrong. The
 * training-overview charts bucket by week with `getMonday` in
 * analyticsService.ts, not with either of these.
 *
 * An unusable timezone degrades to UTC via {@link getLocalDateStrSafe} rather
 * than throwing — a stale `users.userTimezone` must not 500 a read.
 */
export function getLocalMondayWeekBoundaries(now: Date, tz: string): LocalMondayWeekBoundaries {
  const current = getWeekRangeForDate(getLocalDateStrSafe(now, tz));
  return { current, previous: getWeekRangeForDate(addDaysLocal(current.weekStart, -7)) };
}
