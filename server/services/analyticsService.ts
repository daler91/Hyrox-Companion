interface ExerciseSet {
  exerciseName: string;
  customLabel?: string | null;
  category: string;
  date: string;
  workoutLogId: string;
  setNumber: number;
  reps?: number | null;
  weight?: number | null;
  distance?: number | null;
  time?: number | null;
}

interface PRRecord {
  category: string;
  customLabel?: string | null;
  maxWeight?: { value: number; date: string; workoutLogId: string };
  maxDistance?: { value: number; date: string; workoutLogId: string };
  bestTime?: { value: number; date: string; workoutLogId: string };
}

function getExerciseKey(set: ExerciseSet): string {
  return set.exerciseName === "custom" && set.customLabel
    ? `custom:${set.customLabel}`
    : set.exerciseName;
}

export function calculatePersonalRecords(allSets: ExerciseSet[]): Record<string, PRRecord> {
  const prs: Record<string, PRRecord> = {};

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

export function calculateExerciseAnalytics(allSets: ExerciseSet[]): Record<string, DayAnalytics[]> {
  const byExercise: Record<string, ExerciseSet[]> = {};

  for (const set of allSets) {
    const exerciseKey = getExerciseKey(set);
    if (!byExercise[exerciseKey]) byExercise[exerciseKey] = [];
    byExercise[exerciseKey].push(set);
  }

  const analytics: Record<string, DayAnalytics[]> = {};

  for (const [exercise, sets] of Object.entries(byExercise)) {
    const byDate: Record<string, ExerciseSet[]> = {};
    for (const s of sets) {
      if (!byDate[s.date]) byDate[s.date] = [];
      byDate[s.date].push(s);
    }

    analytics[exercise] = Object.entries(byDate)
      .map(([date, daySets]) => {
        let totalVolume = 0;
        let maxWeight = 0;
        let totalReps = 0;
        let totalDistance = 0;
        for (const s of daySets) {
          if (s.weight && s.reps) totalVolume += s.weight * s.reps;
          if (s.weight && s.weight > maxWeight) maxWeight = s.weight;
          if (s.reps) totalReps += s.reps;
          if (s.distance) totalDistance += s.distance;
        }
        return { date, totalVolume, maxWeight, totalSets: daySets.length, totalReps, totalDistance };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  return analytics;
}
