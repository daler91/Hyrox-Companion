import type { ExerciseSet, PersonalRecord, WorkoutLog, TrainingOverview, WeeklySummary } from "@shared/schema";
import { HYROX_STATIONS_WITH_RUNNING } from "../constants";

export type ExerciseSetWithDate = ExerciseSet & { date: string };

function getExerciseKey(set: ExerciseSetWithDate): string {
  return set.exerciseName === "custom" && set.customLabel
    ? `custom:${set.customLabel}`
    : set.exerciseName;
}

export function calculatePersonalRecords(allSets: ExerciseSetWithDate[]): Record<string, PersonalRecord> {
  const prs: Record<string, PersonalRecord> = {};

  for (const set of allSets) {
    const prKey = getExerciseKey(set);
    if (!prs[prKey]) prs[prKey] = { category: set.category, customLabel: set.customLabel };
    const pr = prs[prKey];
    if (set.weight && (!pr.maxWeight || set.weight > pr.maxWeight.value)) {
      pr.maxWeight = { value: set.weight, date: set.date, workoutLogId: set.workoutLogId };
    }
    if (set.distance && (!pr.maxDistance || set.distance > pr.maxDistance.value)) {
      pr.maxDistance = { value: set.distance, date: set.date, workoutLogId: set.workoutLogId };
    }
    if (set.time && set.time > 0 && (!pr.bestTime || set.time < pr.bestTime.value)) {
      pr.bestTime = { value: set.time, date: set.date, workoutLogId: set.workoutLogId };
    }
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

export function calculateExerciseAnalytics(allSets: ExerciseSetWithDate[]): Record<string, DayAnalytics[]> {
  const analytics: Record<string, Record<string, DayAnalytics>> = {};

  allSets.forEach((s) => {
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

    const day = byDate[s.date];
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
  });

  const finalAnalytics: Record<string, DayAnalytics[]> = {};
  Object.entries(analytics).forEach(([exercise, data]) => {
    // Fast string comparison for YYYY-MM-DD dates instead of localeCompare
    finalAnalytics[exercise] = Object.values(data).sort((a, b) => {
      if (b.date < a.date) return 1;
      if (b.date > a.date) return -1;
      return 0;
    });
  });

  return finalAnalytics;
}

function getMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

export function calculateTrainingOverview(
  workoutLogs: WorkoutLog[],
  exerciseSets: ExerciseSetWithDate[],
): TrainingOverview {
  // Weekly summaries
  const weekMap = new Map<string, { count: number; totalDuration: number; rpeSum: number; rpeCount: number; categoryBreakdown: Record<string, number> }>();
  const workoutDates: string[] = [];

  for (const log of workoutLogs) {
    const weekStart = getMonday(log.date);
    if (!weekMap.has(weekStart)) {
      weekMap.set(weekStart, { count: 0, totalDuration: 0, rpeSum: 0, rpeCount: 0, categoryBreakdown: {} });
    }
    const week = weekMap.get(weekStart)!;
    week.count++;
    if (log.duration) week.totalDuration += log.duration;
    if (log.rpe) { week.rpeSum += log.rpe; week.rpeCount++; }

    const focus = (log.focus || "other").toLowerCase();
    week.categoryBreakdown[focus] = (week.categoryBreakdown[focus] || 0) + 1;

    workoutDates.push(log.date);
  }

  const weeklySummaries: WeeklySummary[] = Array.from(weekMap.entries())
    .map(([weekStart, w]) => ({
      weekStart,
      workoutCount: w.count,
      totalDuration: w.totalDuration,
      avgRpe: w.rpeCount > 0 ? Math.round((w.rpeSum / w.rpeCount) * 10) / 10 : null,
      categoryBreakdown: w.categoryBreakdown,
    }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0));

  // Category totals from exercise sets
  const categoryTotals: Record<string, { count: number; totalSets: number }> = {};
  const exercisesByCategory = new Map<string, Set<string>>();

  for (const set of exerciseSets) {
    const cat = set.category || "other";
    if (!categoryTotals[cat]) categoryTotals[cat] = { count: 0, totalSets: 0 };
    categoryTotals[cat].totalSets++;

    if (!exercisesByCategory.has(cat)) exercisesByCategory.set(cat, new Set());
    exercisesByCategory.get(cat)?.add(set.workoutLogId);
  }

  // Count unique workout logs per category
  for (const [cat, logIds] of exercisesByCategory) {
    categoryTotals[cat].count = logIds.size;
  }

  // Station coverage
  const todayStr = new Date().toISOString().split("T")[0];
  const stationLastTrained = new Map<string, string>();

  for (const set of exerciseSets) {
    const key = getExerciseKey(set);
    const normalizedKey = key.toLowerCase().replace(/[\s-]/g, "_");

    for (const station of HYROX_STATIONS_WITH_RUNNING) {
      if (normalizedKey === station || normalizedKey.includes(station)) {
        const existing = stationLastTrained.get(station);
        if (!existing || set.date > existing) {
          stationLastTrained.set(station, set.date);
        }
      }
    }
  }

  const stationCoverage = HYROX_STATIONS_WITH_RUNNING.map((station) => {
    const lastTrained = stationLastTrained.get(station) || null;
    let daysSince: number | null = null;
    if (lastTrained) {
      daysSince = Math.round(
        (new Date(todayStr).getTime() - new Date(lastTrained).getTime()) / (1000 * 60 * 60 * 24)
      );
    }
    return { station, lastTrained, daysSince };
  });

  return { weeklySummaries, workoutDates, categoryTotals, stationCoverage };
}
