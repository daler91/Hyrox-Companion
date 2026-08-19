/**
 * Weekly review assembly — the read behind `GET /api/v1/weekly-review`.
 *
 * Every number here already existed; the weekly summary email
 * (`server/emailScheduler.ts`) has been computing most of them once a week and
 * posting them to an email address. This assembles the same picture for a week
 * the athlete picks, in their own Monday→Sunday calendar
 * (docs/weekly-review-spec.md).
 *
 * Deliberately NOT persisted to `analytics_results`: that table's `feature`
 * column is constrained to four literals, so a stored weekly review would need
 * a constraint migration plus a recompute path plus staleness handling — for a
 * payload that is four bounded queries.
 */

import { type AbsenceRange, isDateExcused, isExcusedFromMissed } from "@shared/absence";
import type {
  PersonalRecord,
  PersonalRecordMetric,
  PlanDaySkipReason,
  WeeklyReview,
  WeeklyReviewAnnotation,
  WeeklyReviewCounts,
  WeeklyReviewDeltas,
  WeeklyReviewPersonalRecord,
  WeeklyReviewPlannedDay,
  WeeklyReviewSession,
} from "@shared/schema";

import type { IStorage } from "../storage";
import { addDaysLocal, getLocalDateStrSafe, isValidTimezone } from "../timezone";
import { calculatePersonalRecords } from "./analyticsService";
import { getLocalMondayWeekBoundaries, getWeekRangeForDate, type LocalWeekRange } from "./weeklyProgress";

const PR_METRICS: readonly PersonalRecordMetric[] = ["maxWeight", "maxDistance", "bestTime", "estimated1RM"];

/** Statuses a plan day can hold that mean "this did not become a session". */
const UNCOMPLETED_STATUSES = new Set(["planned", "missed", "skipped"]);

type PlanDayRow = Awaited<ReturnType<IStorage["analytics"]["getPlanDaysByDateRange"]>>[number];
type WorkoutLogRow = Awaited<ReturnType<IStorage["analytics"]["getWorkoutLogsByDateRange"]>>[number];

/**
 * Resolve which week to report on.
 *
 * `requestedWeek` is any date inside the wanted week — the caller may pass a
 * Monday, but anchoring rather than validating means a link to a Wednesday
 * still opens the right week instead of 400-ing. With no request, the default
 * is the most recently *completed* week, which is what a review is for.
 */
export function resolveReviewWeek(
  now: Date,
  tz: string,
  requestedWeek?: string,
): { week: LocalWeekRange; isCurrentWeek: boolean } {
  const { current, previous } = getLocalMondayWeekBoundaries(now, tz);
  const week = requestedWeek ? getWeekRangeForDate(requestedWeek) : previous;
  return { week, isCurrentWeek: week.weekStart === current.weekStart };
}

/**
 * A day held out of `missed` by a declared absence. Excused days can sit in the
 * DB under either status: `missed` when the nightly sweep ran before the
 * athlete logged the annotation, `planned` when it ran after (the sweep skips
 * covered days). The rule has to catch both, and it is the same rule the
 * timeline's "Not counted" badge applies — shared so they cannot disagree.
 */
function isExcusedDay(day: PlanDayRow, ranges: readonly AbsenceRange[], today: string): boolean {
  return isExcusedFromMissed(day.status, day.date, today, isDateExcused(day.date, ranges));
}

function buildCounts(
  logs: WorkoutLogRow[],
  planDays: PlanDayRow[],
  ranges: readonly AbsenceRange[],
  today: string,
): WeeklyReviewCounts {
  // ⚡ Bolt Performance Optimization:
  // Replaced multiple `.filter()` scans and chained array methods
  // (`.map().filter().reduce()`) with single-pass `for...of` loops.
  // This eliminates intermediate array allocations, avoids multiple O(N) iterations,
  // and reduces memory overhead when building weekly summaries.
  let plannedCompleted = 0;
  let missed = 0;
  let skipped = 0;
  let outstanding = 0;
  let excused = 0;

  for (const d of planDays) {
    if (isExcusedDay(d, ranges, today)) {
      excused++;
      continue;
    }
    switch (d.status) {
      case "completed":
        plannedCompleted++;
        break;
      case "missed":
        missed++;
        break;
      case "skipped":
        skipped++;
        break;
      case "planned":
        outstanding++;
        break;
    }
  }

  let totalDurationMin = 0;
  let rpeSum = 0;
  let rpeCount = 0;

  for (const l of logs) {
    if (l.duration != null) totalDurationMin += l.duration;
    if (typeof l.rpe === "number") {
      rpeSum += l.rpe;
      rpeCount++;
    }
  }

  return {
    sessionsLogged: logs.length,
    sessionsPlanned: planDays.length,
    plannedCompleted,
    missed,
    skipped,
    outstanding,
    excused,
    totalDurationMin,
    avgRpe: rpeCount === 0 ? null : Math.round((rpeSum / rpeCount) * 10) / 10,
  };
}

function buildDeltas(current: WeeklyReviewCounts, previous: WeeklyReviewCounts): WeeklyReviewDeltas {
  return {
    sessionsLogged: current.sessionsLogged - previous.sessionsLogged,
    totalDurationMin: current.totalDurationMin - previous.totalDurationMin,
    // A delta against a week with no RPE at all would read as a collapse rather
    // than as missing data, so it stays null until both sides have a value.
    avgRpe:
      current.avgRpe === null || previous.avgRpe === null
        ? null
        : Math.round((current.avgRpe - previous.avgRpe) * 10) / 10,
  };
}

function buildSessions(logs: WorkoutLogRow[]): WeeklyReviewSession[] {
  return logs
    .map((log) => ({
      workoutLogId: log.id,
      date: log.date,
      focus: log.focus,
      durationMin: log.duration ?? null,
      rpe: log.rpe ?? null,
      source: log.source ?? "manual",
      planDayId: log.planDayId ?? null,
      compliancePct: log.compliancePct ?? null,
      matchedSetCount: log.matchedSetCount ?? null,
      addedSetCount: log.addedSetCount ?? null,
      removedSetCount: log.removedSetCount ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The plan days that did not become sessions. Completed days are omitted on
 * purpose — they are already in `sessions`, with far more detail.
 */
function buildPlannedDays(
  planDays: PlanDayRow[],
  ranges: readonly AbsenceRange[],
  today: string,
): WeeklyReviewPlannedDay[] {
  return planDays
    .filter((day) => UNCOMPLETED_STATUSES.has(day.status))
    .map((day) => ({
      planDayId: day.id,
      date: day.date,
      focus: day.focus,
      status: day.status as WeeklyReviewPlannedDay["status"],
      skipReason: (day.skipReason as PlanDaySkipReason | null) ?? null,
      planName: day.planName,
      excused: isExcusedDay(day, ranges, today),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * All-time bests whose first achievement lands inside the week.
 *
 * Needs the athlete's full history, not the week's sets: "a PR" means an
 * all-time best, and a week-scoped fetch would call every heaviest lift of the
 * week a record. Same computation the weekly email's PR count runs, kept at the
 * same per-metric grain — this returns the records themselves so the review can
 * name them, which a count cannot.
 */
export function listPersonalRecordsInRange(
  prs: Record<string, PersonalRecord>,
  fromStr: string,
  toStr: string,
): WeeklyReviewPersonalRecord[] {
  const records: WeeklyReviewPersonalRecord[] = [];
  for (const [exerciseName, pr] of Object.entries(prs)) {
    for (const metric of PR_METRICS) {
      const value = pr[metric];
      if (!value || value.date < fromStr || value.date > toStr) continue;
      records.push({
        exerciseName,
        customLabel: pr.customLabel ?? null,
        category: pr.category,
        metric,
        value: value.value,
        date: value.date,
        workoutLogId: value.workoutLogId,
      });
    }
  }
  return records.sort((a, b) => a.date.localeCompare(b.date) || a.exerciseName.localeCompare(b.exerciseName));
}

/**
 * Annotations overlapping the week — an injury or illness range is context the
 * review has to carry, because a light week inside one is not a failed week.
 * Overlap, not containment: a three-week injury covers this week without
 * starting or ending in it.
 */
function buildAnnotations(
  annotations: { id: string; startDate: string; endDate: string; type: string; note: string | null }[],
  week: LocalWeekRange,
): WeeklyReviewAnnotation[] {
  return annotations
    .filter((a) => a.startDate <= week.weekEnd && a.endDate >= week.weekStart)
    .map((a) => ({
      id: a.id,
      type: a.type,
      startDate: a.startDate,
      endDate: a.endDate,
      note: a.note,
    }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export async function buildWeeklyReview(
  storage: IStorage,
  userId: string,
  options: { now?: Date; week?: string } = {},
): Promise<WeeklyReview> {
  const now = options.now ?? new Date();
  const user = await storage.users.getUser(userId);
  const rawTz = user?.userTimezone ?? "UTC";
  // The week is resolved in whatever zone we can actually use, and the payload
  // reports that zone rather than the stored one, so a client rendering
  // "week of…" never labels a UTC-resolved week with a timezone it wasn't
  // resolved in.
  const tz = isValidTimezone(rawTz) ? rawTz : "UTC";

  const { week, isCurrentWeek } = resolveReviewWeek(now, tz, options.week);
  const prior = getWeekRangeForDate(addDaysLocal(week.weekStart, -7));

  const [logs, planDays, priorLogs, priorPlanDays, prSets, annotations, intents] = await Promise.all([
    storage.analytics.getWorkoutLogsByDateRange(userId, week.weekStart, week.weekEnd),
    storage.analytics.getPlanDaysByDateRange(userId, week.weekStart, week.weekEnd),
    storage.analytics.getWorkoutLogsByDateRange(userId, prior.weekStart, prior.weekEnd),
    storage.analytics.getPlanDaysByDateRange(userId, prior.weekStart, prior.weekEnd),
    storage.analytics.getExerciseSetsForPersonalRecords(userId),
    storage.timelineAnnotations.list(userId),
    // Both weeks in one round trip — this week's intent to edit, last week's
    // to show back.
    storage.weeklyReviews.getIntents(userId, [week.weekStart, prior.weekStart]),
  ]);

  // The athlete's own calendar date. Only days already in the past can be
  // excused (a booked absence next week has excused nothing yet), and for the
  // default review — last week — every day qualifies; today only matters when
  // the athlete is looking at the in-progress week.
  const today = getLocalDateStrSafe(now, tz);
  // The raw list, not the week-filtered `annotations` payload below: excusal is
  // a per-day containment test, so pre-filtering buys nothing — and the PRIOR
  // week's counts need ranges that overlap that week, not this one.
  const current = buildCounts(logs, planDays, annotations, today);
  const previous = buildCounts(priorLogs, priorPlanDays, annotations, today);

  return {
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    timezone: tz,
    isCurrentWeek,
    weeklyGoal: user?.weeklyGoal ?? 5,
    hasPlan: planDays.length > 0,
    current,
    previous,
    deltas: buildDeltas(current, previous),
    sessions: buildSessions(logs),
    plannedDays: buildPlannedDays(planDays, annotations, today),
    personalRecords: listPersonalRecordsInRange(
      calculatePersonalRecords(prSets),
      week.weekStart,
      week.weekEnd,
    ),
    annotations: buildAnnotations(annotations, week),
    intent: intents.get(week.weekStart) ?? null,
    previousIntent: intents.get(prior.weekStart) ?? null,
  };
}

/**
 * Exported for the route's validation, so both agree on what a week param is.
 *
 * Stricter than `dateStringSchema`, which checks only the shape: a well-formed
 * but impossible date ("2026-02-31") passes the regex and then rolls forward
 * into March, so the athlete would silently get a week they never asked for.
 * Component round-tripping is the check; no `Intl` and no string parsing, both
 * of which throw on inputs this function is supposed to reject calmly.
 */
export function isWeekParamValid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yyyy, mm, dd] = match;
  const utc = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return (
    utc.getUTCFullYear() === Number(yyyy)
    && utc.getUTCMonth() === Number(mm) - 1
    && utc.getUTCDate() === Number(dd)
  );
}
