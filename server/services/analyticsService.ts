import { pooledRatio, roundOrNull, weightedMean } from "@shared/ratio";
import type {
  ExerciseLoadTag,
  HeatMapMuscle,
  MovementPattern,
  MovementPatternCoverage,
  MuscleGroupCoverage,
  OverviewStats,
  PersonalRecord,
  TrainingOverview,
  WeeklySummary,
  WorkoutLog,
} from "@shared/schema";
import {
  getExerciseHeatMapMuscles,
  getExerciseMovementPatterns,
  MOVEMENT_PATTERNS,
  MUSCLE_HEAT_MAP_GROUPS,
} from "@shared/schema";
import { buildStationCoverage, type StationCoverageSource } from "@shared/stationCoverage";

import { calculateStreak } from "../routeUtils";
import type { LoggedExerciseSetWithDate, SlimLoggedExerciseSet } from "../storage/shared";
import { getLocalDateStrSafe } from "../timezone";
import { type AthleteLoadContext, calculateTrainingLoad } from "./trainingLoadService";
import { getMondayWeekBoundaries } from "./weeklyProgress";

// Analytics always operates on logged sets, so workoutLogId is guaranteed
// non-null here. Use the narrowed LoggedExerciseSetWithDate from the
// storage layer rather than the base ExerciseSet which allows null owners.
export type ExerciseSetWithDate = LoggedExerciseSetWithDate;

function getExerciseKey(set: SlimLoggedExerciseSet): string {
  return set.exerciseName === "custom" && set.customLabel
    ? `custom:${set.customLabel}`
    : set.exerciseName;
}

// Epley formula — reliable up to ~10 reps; above that the estimate degrades
// quickly and reps tend to be capacity/endurance rather than strength.
// 1-rep sets are intentionally excluded: the heavy single already appears as
// maxWeight, and rendering an identical "e1RM" chip next to it is noise.
const EPLEY_MIN_REPS = 2;
const EPLEY_MAX_REPS = 10;
function estimateOneRepMax(weight: number, reps: number): number {
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

function updateMaxWeight(pr: PersonalRecord, set: SlimLoggedExerciseSet): void {
  if (set.weight && (!pr.maxWeight || set.weight > pr.maxWeight.value)) {
    pr.maxWeight = { value: set.weight, date: set.date, workoutLogId: set.workoutLogId };
  }
}

function updateMaxDistance(pr: PersonalRecord, set: SlimLoggedExerciseSet): void {
  if (set.distance && (!pr.maxDistance || set.distance > pr.maxDistance.value)) {
    pr.maxDistance = { value: set.distance, date: set.date, workoutLogId: set.workoutLogId };
  }
}

// For most timed exercises `time` is completion/effort time where a LOWER value
// is the better result. Two exceptions, handled below:
//   - Isometric holds / time-under-tension (sets+time only): a LONGER hold is
//     the better result, so "best time" must track the MAX. Without this, a
//     shorter plank would wrongly register as a new "best time" PR.
//   - AMRAP/EMOM: `time` is a prescribed cap, not a performance metric, so a
//     "best time" PR is meaningless and is not recorded (reps/rounds is the
//     score for those).
const TIME_LONGER_IS_BETTER = new Set<string>([
  "plank",
  "side_plank",
  "hollow_hold",
  "battle_ropes",
]);
const TIME_NOT_A_PR_METRIC = new Set<string>(["amrap", "emom"]);

/**
 * Direction-aware "is this time a better PR" comparison, for callers that
 * compare two already-computed bestTime records (e.g. new-PR achievement
 * detection). Mirrors updateBestTime exactly: longer is better for isometric
 * holds, AMRAP/EMOM never count as a time PR, otherwise faster is better.
 */
export function isTimePrImprovement(exerciseName: string, current: number, previous: number): boolean {
  if (TIME_NOT_A_PR_METRIC.has(exerciseName)) return false;
  return TIME_LONGER_IS_BETTER.has(exerciseName) ? current > previous : current < previous;
}

function updateBestTime(pr: PersonalRecord, set: SlimLoggedExerciseSet): void {
  if (!set.time || set.time <= 0) return;
  if (TIME_NOT_A_PR_METRIC.has(set.exerciseName)) return;

  const longerIsBetter = TIME_LONGER_IS_BETTER.has(set.exerciseName);
  const isImprovement =
    !pr.bestTime ||
    (longerIsBetter ? set.time > pr.bestTime.value : set.time < pr.bestTime.value);

  if (isImprovement) {
    pr.bestTime = { value: set.time, date: set.date, workoutLogId: set.workoutLogId };
  }
}

type E1RMCandidate = SlimLoggedExerciseSet & { weight: number; reps: number };

function isE1RMCandidate(set: SlimLoggedExerciseSet): set is E1RMCandidate {
  return (
    set.category === "strength" &&
    !!set.weight &&
    !!set.reps &&
    set.reps >= EPLEY_MIN_REPS &&
    set.reps <= EPLEY_MAX_REPS
  );
}

function updateE1RM(pr: PersonalRecord, set: SlimLoggedExerciseSet): void {
  if (!isE1RMCandidate(set)) return;
  const e1rm = estimateOneRepMax(set.weight, set.reps);
  if (!pr.estimated1RM || e1rm > pr.estimated1RM.value) {
    pr.estimated1RM = { value: e1rm, date: set.date, workoutLogId: set.workoutLogId };
  }
}

export function calculatePersonalRecords(allSets: SlimLoggedExerciseSet[]): Record<string, PersonalRecord> {
  const prs: Record<string, PersonalRecord> = Object.create(null) as Record<string, PersonalRecord>;

  for (const set of allSets) {
    const prKey = getExerciseKey(set);
    if (!prs[prKey]) prs[prKey] = { category: set.category, customLabel: set.customLabel };
    const pr = prs[prKey];
    updateMaxWeight(pr, set);
    updateMaxDistance(pr, set);
    updateBestTime(pr, set);
    updateE1RM(pr, set);
  }

  return prs;
}

/**
 * Count personal records whose all-time best was achieved within
 * [fromStr, toStr] (inclusive, YYYY-MM-DD). Powers the weekly-summary email's
 * "PRs This Week" stat (W18). Counts per metric (maxWeight / maxDistance /
 * bestTime / estimated1RM), matching findPersonalRecordAchievements' grain.
 */
export function countPersonalRecordsInRange(
  prs: Record<string, PersonalRecord>,
  fromStr: string,
  toStr: string,
): number {
  let count = 0;
  for (const pr of Object.values(prs)) {
    for (const value of [pr.maxWeight, pr.maxDistance, pr.bestTime, pr.estimated1RM]) {
      if (value && value.date >= fromStr && value.date <= toStr) count++;
    }
  }
  return count;
}

interface DayAnalytics {
  date: string;
  totalVolume: number;
  maxWeight: number;
  totalSets: number;
  totalReps: number;
  totalDistance: number;
}

function accumulateSet(day: DayAnalytics, s: ExerciseSetWithDate): void {
  day.totalSets += 1;
  if (s.weight && s.reps) {
    day.totalVolume += s.weight * s.reps;
  }
  if (s.weight && s.weight > day.maxWeight) {
    day.maxWeight = s.weight;
  }
  if (s.reps) {
    day.totalReps += s.reps;
  }
  if (s.distance) {
    day.totalDistance += s.distance;
  }
}

function sortByDateAsc(a: DayAnalytics, b: DayAnalytics): number {
  if (a.date < b.date) return -1;
  if (a.date > b.date) return 1;
  return 0;
}

export function calculateExerciseAnalytics(allSets: ExerciseSetWithDate[]): Record<string, DayAnalytics[]> {
  const analytics: Record<string, Record<string, DayAnalytics>> = {};

  for (const s of allSets) {
    const exerciseKey = getExerciseKey(s);

    if (!analytics[exerciseKey]) {
      analytics[exerciseKey] = {};
    }

    const byDate = analytics[exerciseKey];

    if (!byDate[s.date]) {
      byDate[s.date] = {
        date: s.date,
        totalVolume: 0,
        maxWeight: 0,
        totalSets: 0,
        totalReps: 0,
        totalDistance: 0
      };
    }

    accumulateSet(byDate[s.date], s);
  }

  const finalAnalytics: Record<string, DayAnalytics[]> = {};
  for (const [exercise, data] of Object.entries(analytics)) {
    finalAnalytics[exercise] = Object.values(data).sort(sortByDateAsc);
  }

  return finalAnalytics;
}

const mondayCache = new Map<string, string>();
const MONDAY_CACHE_MAX_SIZE = 1000;
function getMonday(dateStr: string): string {
  let res = mondayCache.get(dateStr);
  if (res) return res;

  // Parsed as UTC above, so read and write in UTC too: getDay()/setDate() are
  // local-time accessors and would shift the week boundary under any server TZ
  // that is not UTC.
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  res = d.toISOString().split("T")[0];
  mondayCache.set(dateStr, res);
  if (mondayCache.size > MONDAY_CACHE_MAX_SIZE) {
    const oldestKey = mondayCache.keys().next().value;
    if (oldestKey) mondayCache.delete(oldestKey);
  }
  return res;
}

type WeekAccumulator = { count: number; totalDuration: number; durationCount: number; rpeSum: number; rpeCount: number; categoryBreakdown: Record<string, number> };

const emptyWeek = (): WeekAccumulator => ({
  count: 0,
  totalDuration: 0,
  durationCount: 0,
  rpeSum: 0,
  rpeCount: 0,
  categoryBreakdown: {},
});

/**
 * Insert an empty entry for every week in the range that holds no workout, so
 * rest weeks reach the denominator and the chart (audit H7, M10).
 *
 * Bounds come from the selected period when there is one, else from the
 * athlete's own first and last logged week.
 */
function zeroFillWeeks(weekMap: Map<string, WeekAccumulator>, period?: { from?: string; to?: string }): void {
  // Scan for the two ends rather than sorting for them: only the min and max
  // are wanted, and a bare `.sort()` on strings is a UTF-16 code-unit sort with
  // no comparator, which SonarCloud flags as a reliability bug (S2871). The
  // comparisons below are still string comparisons, which is exact here because
  // `getMonday` yields fixed-width most-significant-first `YYYY-MM-DD`.
  let earliestObserved: string | undefined;
  let latestObserved: string | undefined;
  for (const weekStart of weekMap.keys()) {
    if (earliestObserved == null || weekStart < earliestObserved) earliestObserved = weekStart;
    if (latestObserved == null || weekStart > latestObserved) latestObserved = weekStart;
  }
  const fromMonday = period?.from ? getMonday(period.from) : earliestObserved;
  const toMonday = period?.to ? getMonday(period.to) : latestObserved;
  if (!fromMonday || !toMonday || fromMonday > toMonday) return;
  for (const weekStart of mondaysBetween(fromMonday, toMonday)) {
    if (!weekMap.has(weekStart)) weekMap.set(weekStart, emptyWeek());
  }
}

/** Every Monday from `fromMonday` to `toMonday` inclusive. */
function mondaysBetween(fromMonday: string, toMonday: string): string[] {
  const weeks: string[] = [];
  let cursor = fromMonday;
  // Bounded so a bad range cannot spin: 20 years of weeks is far past any
  // real training history and still terminates.
  for (let i = 0; i < 1040 && cursor <= toMonday; i++) {
    weeks.push(cursor);
    const d = new Date(cursor + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 7);
    cursor = d.toISOString().split("T")[0];
  }
  return weeks;
}

/**
 * Build the per-week rollup, INCLUDING weeks the athlete did not train.
 *
 * The map used to gain a key only when a workout landed in that week, so a
 * rest week did not exist as far as every downstream consumer was concerned.
 * Two things followed: "Avg / Week" divided by the number of weeks CONTAINING
 * a workout and so could never fall below 1.0 (audit H7 — train 3x, rest three
 * weeks, train 3x reported 3.0/week instead of 1.2), and the weekly bar chart
 * simply deleted the layoff, rendering a break as though it never happened
 * (audit M10).
 *
 * `period` is the window the athlete actually selected. When it is absent
 * ("all time") the span of their own logs is used instead, which still restores
 * the interior rest weeks; a selected window additionally restores leading and
 * trailing ones.
 */
function buildWeeklySummaries(
  workoutLogs: WorkoutLog[],
  period?: { from?: string; to?: string },
): { summaries: WeeklySummary[]; workoutDates: string[] } {
  const weekMap = new Map<string, WeekAccumulator>();
  const workoutDates: string[] = [];

  for (const log of workoutLogs) {
    const weekStart = getMonday(log.date);
    if (!weekMap.has(weekStart)) {
      weekMap.set(weekStart, emptyWeek());
    }
    // Safe: we just set this key above if it was missing
    const week = weekMap.get(weekStart);
    if (!week) continue;
    week.count++;
    // `!= null` rather than truthiness: a genuinely 0-minute log is a recorded
    // duration, not a missing one, and counting it as missing was part of H8.
    if (log.duration != null) { week.totalDuration += log.duration; week.durationCount++; }
    if (log.rpe) { week.rpeSum += log.rpe; week.rpeCount++; }

    const focus = (log.focus ?? "other").toLowerCase();
    week.categoryBreakdown[focus] = (week.categoryBreakdown[focus] ?? 0) + 1;

    workoutDates.push(log.date);
  }

  zeroFillWeeks(weekMap, period);

  const summaries: WeeklySummary[] = Array.from(weekMap.entries())
    .map(([weekStart, w]) => ({
      weekStart,
      workoutCount: w.count,
      totalDuration: w.totalDuration,
      avgRpe: w.rpeCount > 0 ? Math.round((w.rpeSum / w.rpeCount) * 10) / 10 : null,
      categoryBreakdown: w.categoryBreakdown,
      workoutsWithDuration: w.durationCount,
      rpeCount: w.rpeCount,
    }))
    .sort((a, b) => {
      if (b.weekStart < a.weekStart) return 1;
      if (b.weekStart > a.weekStart) return -1;
      return 0;
    });

  return { summaries, workoutDates };
}

function buildCategoryTotals(
  exerciseSets: ExerciseSetWithDate[],
): Record<string, { count: number; totalSets: number }> {
  const categoryTotals: Record<string, { count: number; totalSets: number }> = {};
  const exercisesByCategory = new Map<string, Set<string>>();

  for (const set of exerciseSets) {
    const cat = set.category ?? "other";
    if (!categoryTotals[cat]) categoryTotals[cat] = { count: 0, totalSets: 0 };
    categoryTotals[cat].totalSets++;

    if (!exercisesByCategory.has(cat)) exercisesByCategory.set(cat, new Set());
    exercisesByCategory.get(cat)?.add(set.workoutLogId);
  }

  for (const [cat, logIds] of exercisesByCategory) {
    categoryTotals[cat].count = logIds.size;
  }

  return categoryTotals;
}

/**
 * Group logged sets into one coverage source per session, carrying the parent
 * log's `focus` and any custom-exercise labels as free text.
 *
 * The focus is what lets the card agree with the AI coach, which has always
 * keyword-scanned it; the custom labels preserve what the old substring match
 * gave us for free, where a set logged as custom "Heavy sled push finisher"
 * counted toward the sled push. `workoutLogs` may be empty while sets are not
 * (several analytics callers pass only sets), so the focus is optional.
 */
function buildCoverageSources(
  workoutLogs: WorkoutLog[],
  exerciseSets: ExerciseSetWithDate[],
): StationCoverageSource[] {
  const focusByLogId = new Map<string, string>();
  for (const log of workoutLogs) {
    if (log.focus) focusByLogId.set(log.id, log.focus);
  }

  // Keyed by (log, date) rather than log alone. A log has one date in practice,
  // but a set carries its own, and grouping on the log would date every station
  // in the group from whichever set happened to be seen first.
  const sources = new Map<string, { date: string; exerciseNames: string[]; freeText: string[] }>();
  const seenLogIds = new Set<string>();

  for (const set of exerciseSets) {
    const key = `${set.workoutLogId}:${set.date}`;
    let source = sources.get(key);
    if (!source) {
      const focus = focusByLogId.get(set.workoutLogId);
      source = { date: set.date, exerciseNames: [], freeText: focus ? [focus] : [] };
      sources.set(key, source);
    }
    seenLogIds.add(set.workoutLogId);
    source.exerciseNames.push(set.exerciseName);
    if (set.customLabel) source.freeText.push(set.customLabel);
  }

  // Sessions with no sets at all still carry a focus worth scanning.
  for (const log of workoutLogs) {
    if (seenLogIds.has(log.id) || !log.focus) continue;
    sources.set(`${log.id}:${log.date}`, { date: log.date, exerciseNames: [], freeText: [log.focus] });
  }

  return [...sources.values()];
}

function calculateDaysSince(lastTrained: string | null, todayStr: string): number | null {
  if (!lastTrained) return null;
  // ⚡ Bolt Performance Optimization:
  // Replaced `new Date(date).getTime()` with `Date.parse(date)` to avoid intermediate
  // Date object allocations. This yields ~60% faster executions for frequent YYYY-MM-DD
  // date difference calculations across movement patterns and muscle group mapping.
  return Math.round((Date.parse(todayStr) - Date.parse(lastTrained)) / 86400000);
}

export function buildMovementPatternCoverage(
  exerciseSets: ExerciseSetWithDate[],
  todayStr: string,
): MovementPatternCoverage[] {
  const patternStats = new Map<MovementPattern, {
    workoutLogIds: Set<string>;
    totalSets: number;
    lastTrained: string | null;
  }>();

  for (const { pattern } of MOVEMENT_PATTERNS) {
    patternStats.set(pattern, {
      workoutLogIds: new Set<string>(),
      totalSets: 0,
      lastTrained: null,
    });
  }

  for (const set of exerciseSets) {
    const patterns = getExerciseMovementPatterns(set.exerciseName);
    for (const pattern of patterns) {
      const stats = patternStats.get(pattern);
      if (!stats) continue;
      stats.workoutLogIds.add(set.workoutLogId);
      stats.totalSets += 1;
      if (!stats.lastTrained || set.date > stats.lastTrained) {
        stats.lastTrained = set.date;
      }
    }
  }

  return MOVEMENT_PATTERNS.map(({ pattern, label }) => {
    const stats = patternStats.get(pattern);
    const lastTrained = stats?.lastTrained ?? null;
    return {
      pattern,
      label,
      sessionCount: stats?.workoutLogIds.size ?? 0,
      totalSets: stats?.totalSets ?? 0,
      lastTrained,
      daysSince: calculateDaysSince(lastTrained, todayStr),
    };
  });
}

export function buildMuscleGroupCoverage(
  exerciseSets: ExerciseSetWithDate[],
  todayStr: string,
): MuscleGroupCoverage[] {
  const muscleStats = new Map<HeatMapMuscle, {
    workoutLogIds: Set<string>;
    totalSets: number;
    lastTrained: string | null;
  }>();

  for (const { muscle } of MUSCLE_HEAT_MAP_GROUPS) {
    muscleStats.set(muscle, {
      workoutLogIds: new Set<string>(),
      totalSets: 0,
      lastTrained: null,
    });
  }

  for (const set of exerciseSets) {
    const muscles = getExerciseHeatMapMuscles(set.exerciseName);
    for (const muscle of muscles) {
      const stats = muscleStats.get(muscle);
      if (!stats) continue;
      stats.workoutLogIds.add(set.workoutLogId);
      stats.totalSets += 1;
      if (!stats.lastTrained || set.date > stats.lastTrained) {
        stats.lastTrained = set.date;
      }
    }
  }

  return MUSCLE_HEAT_MAP_GROUPS.map(({ muscle, label, bodyRegion }) => {
    const stats = muscleStats.get(muscle);
    const lastTrained = stats?.lastTrained ?? null;
    return {
      muscle,
      label,
      bodyRegion,
      sessionCount: stats?.workoutLogIds.size ?? 0,
      totalSets: stats?.totalSets ?? 0,
      lastTrained,
      daysSince: calculateDaysSince(lastTrained, todayStr),
    };
  });
}

/**
 * Aggregate the flat weekly summaries into the four card-level stats that
 * the Analytics Overview tab renders. Kept as a pure function so it can be
 * reused for both the current period and the previous-period comparison
 * data without duplicating logic on the client.
 */
export function computeOverviewStats(weeklySummaries: WeeklySummary[]): OverviewStats {
  if (weeklySummaries.length === 0) {
    return {
      totalWorkouts: 0,
      avgPerWeek: 0,
      totalDuration: 0,
      avgDuration: 0,
      avgRpe: null,
      avgCompliancePct: null,
    };
  }
  // ⚡ Bolt Performance Optimization:
  // Consolidated two separate loops over weeklySummaries into a single pass
  // to compute totalWorkouts and totalDuration simultaneously, reducing
  // time complexity from O(2N) to O(N).
  let totalWorkouts = 0;
  let totalDuration = 0;
  let workoutsWithDuration = 0;
  for (const w of weeklySummaries) {
    totalWorkouts += w.workoutCount;
    totalDuration += w.totalDuration;
    workoutsWithDuration += w.workoutsWithDuration;
  }
  // `weeklySummaries` is now zero-filled across the period, so rest weeks are
  // in the denominator and this can fall below 1.0 (audit H7).
  const avgPerWeek = roundOrNull(pooledRatio(totalWorkouts, weeklySummaries.length), 1) ?? 0;
  // Divide by the workouts that actually CARRY a duration, not by every
  // workout: the numerator only ever summed those (audit H8).
  const avgDuration = Math.round(roundOrNull(pooledRatio(totalDuration, workoutsWithDuration), 0) ?? 0);

  // Weight each week's mean RPE by how many rated sessions it holds, instead of
  // treating every week as one observation. The unweighted form let a single
  // hard session in a quiet week count as much as six sessions in a heavy one:
  // one RPE-10 workout plus six RPE-4 workouts reported 7.0 instead of 4.9
  // (audit H9). Weeks with no rated session contribute no weight, preserving
  // the original intent that an unrated week must not drag the average down.
  const ratedWeeks = weeklySummaries.filter((w) => w.avgRpe !== null && w.rpeCount > 0);
  const avgRpe = roundOrNull(
    weightedMean(ratedWeeks.map((w) => w.avgRpe as number), ratedWeeks.map((w) => w.rpeCount)),
    1,
  );

  return { totalWorkouts, avgPerWeek, totalDuration, avgDuration, avgRpe, avgCompliancePct: null };
}

export interface TrainingOverviewOptions {
  /**
   * The window the athlete selected, when there is one. Used to zero-fill the
   * weekly rollup so leading and trailing rest weeks count toward "Avg / Week"
   * and appear on the chart, not just the interior ones (audit H7, M10).
   */
  period?: { from?: string; to?: string };
  /**
   * Plan sessions DUE in the window, and the same for the previous window.
   * The denominator for "Avg Adherence" — see the note at its call site and
   * `storage.analytics.getDueSessionCount` (audit H10). Omitted when the
   * caller cannot supply it, in which case adherence is withheld rather than
   * computed over the wrong population.
   */
  dueSessionCount?: number;
  previousDueSessionCount?: number;
  weeklyGoal?: number;
  loadTags?: ExerciseLoadTag[];
  trainingLoadInput?: {
    workoutLogs?: WorkoutLog[];
    exerciseSets?: ExerciseSetWithDate[];
    currentDate?: string;
  };
  userTimezone?: string;
  weightUnit?: string;
  athlete?: AthleteLoadContext;
}

/**
 * Mean adherence across the sessions that were due, as a percentage.
 *
 * Null when the caller could not tell us how many were due, or when none were:
 * an athlete with no plan has no adherence, and showing one is the same class
 * of error as emailing them a 100% completion rate (audit H6, H10).
 */
export function computeAdherencePct(
  logs: readonly { compliancePct?: number | null }[],
  dueSessionCount: number | undefined,
): number | null {
  if (dueSessionCount == null) return null;
  let complianceSum = 0;
  for (const log of logs) {
    if (typeof log.compliancePct === "number") complianceSum += log.compliancePct;
  }
  return roundOrNull(pooledRatio(complianceSum, dueSessionCount), 0);
}

export function calculateTrainingOverview(
  workoutLogs: WorkoutLog[],
  exerciseSets: ExerciseSetWithDate[],
  previousWorkoutLogs?: WorkoutLog[],
  options: TrainingOverviewOptions = {},
): TrainingOverview {
  const {
    period,
    dueSessionCount,
    previousDueSessionCount,
    weeklyGoal = 5,
    loadTags = [],
    trainingLoadInput,
    userTimezone = "UTC",
    weightUnit = "kg",
    athlete,
  } = options;
  const { summaries: weeklySummaries, workoutDates } = buildWeeklySummaries(workoutLogs, period);
  const categoryTotals = buildCategoryTotals(exerciseSets);
  // "Days since last trained" is counted from the ATHLETE's today; the option
  // was already accepted here and used for the streak, while these three
  // builders each minted their own UTC date and so could report a coverage gap
  // a day early for anyone west of UTC.
  const todayStr = getLocalDateStrSafe(new Date(), userTimezone);
  const stationCoverage = buildStationCoverage(buildCoverageSources(workoutLogs, exerciseSets), todayStr);
  const movementPatternCoverage = buildMovementPatternCoverage(exerciseSets, todayStr);
  const muscleGroupCoverage = buildMuscleGroupCoverage(exerciseSets, todayStr);
  const trainingLoad = calculateTrainingLoad(
    trainingLoadInput?.workoutLogs ?? workoutLogs,
    trainingLoadInput?.exerciseSets ?? exerciseSets,
    loadTags,
    {
      ...(trainingLoadInput?.currentDate ? { currentDate: trainingLoadInput.currentDate } : {}),
      weightUnit,
      ...(athlete ? { athlete } : {}),
    },
  ).overview;
  const currentStats = computeOverviewStats(weeklySummaries);
  const completedDates = new Set(workoutLogs.map((log) => log.date));
  // The athlete's week, not the server's: a UTC-8 athlete's weekly count used
  // to reset on Sunday afternoon (audit H11). `userTimezone` was already in
  // scope here for the coverage dates.
  const { thisMondayStr } = getMondayWeekBoundaries(new Date(), userTimezone);
  const weeklyCompletedWorkouts = workoutLogs.filter((log) => log.date >= thisMondayStr).length;
  // ⚡ Bolt Performance Optimization:
  // Replaced chained .map().filter().reduce() with a single for...of loop
  // to avoid intermediate array allocations and O(3N) passes.
  // "Avg Adherence" over the sessions the athlete was DUE, not the ones they
  // logged. Dividing by logged sessions let skipping the plan remove sessions
  // from adherence's own denominator: complete one session at 90% and skip the
  // other four, and the athlete was shown 90% (audit H10).
  //
  // `compliancePct` is only ever written for a plan-linked workout
  // (persistAdherenceSnapshot takes a planDayId), so the numerator population
  // was already right; only the denominator was wrong. A due session with no
  // log contributes 0, which is the point.
  currentStats.avgCompliancePct = computeAdherencePct(workoutLogs, dueSessionCount);

  // Previous-period stats are optional — the route handler omits them
  // when the user picked "all time" (no lower bound → no meaningful
  // previous window).
  const previousStats = previousWorkoutLogs
    ? (() => {
      const stats = computeOverviewStats(buildWeeklySummaries(previousWorkoutLogs).summaries);
      // ⚡ Bolt Performance Optimization:
      // Replaced chained .map().filter().reduce() with a single for...of loop
      // to avoid intermediate array allocations and O(3N) passes.
      stats.avgCompliancePct = computeAdherencePct(previousWorkoutLogs, previousDueSessionCount);
      return stats;
    })()
    : undefined;

  return {
    weeklySummaries,
    workoutDates,
    categoryTotals,
    stationCoverage,
    movementPatternCoverage,
    muscleGroupCoverage,
    currentStats,
    previousStats,
    // Matches the AI context definition: consecutive completed calendar dates
    // ending today or yesterday count; rest days and earlier gaps break it.
    // Anchored to the athlete's local calendar so far-offset users aren't
    // mis-counted (W19).
    currentStreak: calculateStreak(completedDates, userTimezone),
    weeklyCompletedWorkouts,
    weeklyGoal,
    trainingLoad,
  };
}
