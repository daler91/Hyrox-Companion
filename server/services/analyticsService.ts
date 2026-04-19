import type { OverviewStats, PersonalRecord, TrainingOverview, WeeklySummary,WorkoutLog } from "@shared/schema";

import { HYROX_STATIONS_WITH_RUNNING } from "../constants";
import type { LoggedExerciseSetWithDate } from "../storage/shared";

// Analytics always operates on logged sets, so workoutLogId is guaranteed
// non-null here. Use the narrowed LoggedExerciseSetWithDate from the
// storage layer rather than the base ExerciseSet which allows null owners.
export type ExerciseSetWithDate = LoggedExerciseSetWithDate;

function getExerciseKey(set: ExerciseSetWithDate): string {
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

function updateMaxWeight(pr: PersonalRecord, set: ExerciseSetWithDate): void {
  if (set.weight && (!pr.maxWeight || set.weight > pr.maxWeight.value)) {
    pr.maxWeight = { value: set.weight, date: set.date, workoutLogId: set.workoutLogId };
  }
}

function updateMaxDistance(pr: PersonalRecord, set: ExerciseSetWithDate): void {
  if (set.distance && (!pr.maxDistance || set.distance > pr.maxDistance.value)) {
    pr.maxDistance = { value: set.distance, date: set.date, workoutLogId: set.workoutLogId };
  }
}

function updateBestTime(pr: PersonalRecord, set: ExerciseSetWithDate): void {
  if (set.time && set.time > 0 && (!pr.bestTime || set.time < pr.bestTime.value)) {
    pr.bestTime = { value: set.time, date: set.date, workoutLogId: set.workoutLogId };
  }
}

type E1RMCandidate = ExerciseSetWithDate & { weight: number; reps: number };

function isE1RMCandidate(set: ExerciseSetWithDate): set is E1RMCandidate {
  return (
    set.category === "strength" &&
    !!set.weight &&
    !!set.reps &&
    set.reps >= EPLEY_MIN_REPS &&
    set.reps <= EPLEY_MAX_REPS
  );
}

function updateE1RM(pr: PersonalRecord, set: ExerciseSetWithDate): void {
  if (!isE1RMCandidate(set)) return;
  const e1rm = estimateOneRepMax(set.weight, set.reps);
  if (!pr.estimated1RM || e1rm > pr.estimated1RM.value) {
    pr.estimated1RM = { value: e1rm, date: set.date, workoutLogId: set.workoutLogId };
  }
}

export function calculatePersonalRecords(allSets: ExerciseSetWithDate[]): Record<string, PersonalRecord> {
  const prs: Record<string, PersonalRecord> = {};

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
function getMonday(dateStr: string): string {
  let res = mondayCache.get(dateStr);
  if (res) return res;

  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  res = d.toISOString().split("T")[0];
  mondayCache.set(dateStr, res);
  return res;
}

function buildWeeklySummaries(
  workoutLogs: WorkoutLog[],
): { summaries: WeeklySummary[]; workoutDates: string[] } {
  const weekMap = new Map<string, { count: number; totalDuration: number; rpeSum: number; rpeCount: number; categoryBreakdown: Record<string, number> }>();
  const workoutDates: string[] = [];

  for (const log of workoutLogs) {
    const weekStart = getMonday(log.date);
    if (!weekMap.has(weekStart)) {
      weekMap.set(weekStart, { count: 0, totalDuration: 0, rpeSum: 0, rpeCount: 0, categoryBreakdown: {} });
    }
    // Safe: we just set this key above if it was missing
    const week = weekMap.get(weekStart);
    if (!week) continue;
    week.count++;
    if (log.duration) week.totalDuration += log.duration;
    if (log.rpe) { week.rpeSum += log.rpe; week.rpeCount++; }

    const focus = (log.focus ?? "other").toLowerCase();
    week.categoryBreakdown[focus] = (week.categoryBreakdown[focus] ?? 0) + 1;

    workoutDates.push(log.date);
  }

  const summaries: WeeklySummary[] = Array.from(weekMap.entries())
    .map(([weekStart, w]) => ({
      weekStart,
      workoutCount: w.count,
      totalDuration: w.totalDuration,
      avgRpe: w.rpeCount > 0 ? Math.round((w.rpeSum / w.rpeCount) * 10) / 10 : null,
      categoryBreakdown: w.categoryBreakdown,
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

function buildStationCoverage(
  exerciseSets: ExerciseSetWithDate[],
): Array<{ station: string; lastTrained: string | null; daysSince: number | null }> {
  const todayStr = new Date().toISOString().split("T")[0];
  const stationLastTrained = new Map<string, string>();

  // Cache to avoid O(n^2) regex matching and string inclusions inside the loop
  const stationMatchesCache = new Map<string, string[]>();

  for (const set of exerciseSets) {
    const key = getExerciseKey(set);
    let matches = stationMatchesCache.get(key);

    if (!matches) {
      const normalizedKey = key.toLowerCase().replaceAll(/[\s-]/g, "_");
      matches = HYROX_STATIONS_WITH_RUNNING.filter((station) =>
        normalizedKey.includes(station)
      );
      stationMatchesCache.set(key, matches);
    }

    for (const station of matches) {
      const existing = stationLastTrained.get(station);
      if (!existing || set.date > existing) {
        stationLastTrained.set(station, set.date);
      }
    }
  }

  return HYROX_STATIONS_WITH_RUNNING.map((station) => {
    const lastTrained = stationLastTrained.get(station) ?? null;
    let daysSince: number | null = null;
    if (lastTrained) {
      daysSince = Math.round(
        (new Date(todayStr).getTime() - new Date(lastTrained).getTime()) / (1000 * 60 * 60 * 24)
      );
    }
    return { station, lastTrained, daysSince };
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
    return { totalWorkouts: 0, avgPerWeek: 0, totalDuration: 0, avgDuration: 0, avgRpe: null };
  }
  const totalWorkouts = weeklySummaries.reduce((s, w) => s + w.workoutCount, 0);
  const avgPerWeek = Math.round((totalWorkouts / weeklySummaries.length) * 10) / 10;
  const totalDuration = weeklySummaries.reduce((s, w) => s + w.totalDuration, 0);
  const avgDuration = totalWorkouts > 0 ? Math.round(totalDuration / totalWorkouts) : 0;

  // Only average the weeks that actually recorded an RPE, matching the
  // client's existing display logic (otherwise a week of zero-RPE logs
  // would drag the average down).
  const rpeWeeks = weeklySummaries.filter((w) => w.avgRpe !== null);
  const avgRpe = rpeWeeks.length > 0
    ? Math.round((rpeWeeks.reduce((s, w) => s + (w.avgRpe ?? 0), 0) / rpeWeeks.length) * 10) / 10
    : null;

  return { totalWorkouts, avgPerWeek, totalDuration, avgDuration, avgRpe };
}

export function calculateTrainingOverview(
  workoutLogs: WorkoutLog[],
  exerciseSets: ExerciseSetWithDate[],
  previousWorkoutLogs?: WorkoutLog[],
): TrainingOverview {
  const { summaries: weeklySummaries, workoutDates } = buildWeeklySummaries(workoutLogs);
  const categoryTotals = buildCategoryTotals(exerciseSets);
  const stationCoverage = buildStationCoverage(exerciseSets);
  const currentStats = computeOverviewStats(weeklySummaries);

  // Previous-period stats are optional — the route handler omits them
  // when the user picked "all time" (no lower bound → no meaningful
  // previous window).
  const previousStats = previousWorkoutLogs
    ? computeOverviewStats(buildWeeklySummaries(previousWorkoutLogs).summaries)
    : undefined;

  return {
    weeklySummaries,
    workoutDates,
    categoryTotals,
    stationCoverage,
    currentStats,
    previousStats,
  };
}
