import type { ExerciseSet, PersonalRecord } from "@shared/schema";

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
    finalAnalytics[exercise] = Object.values(data).sort((a, b) => a.date.localeCompare(b.date));
  });

  return finalAnalytics;
}
