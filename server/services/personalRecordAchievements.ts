import type {
  ExerciseSet,
  PersonalRecord,
  PersonalRecordAchievement,
  PersonalRecordMetric,
  WorkoutLog,
} from "@shared/schema";

import { calculatePersonalRecords, type ExerciseSetWithDate } from "./analyticsService";

type CreatedWorkoutWithSets = WorkoutLog & { exerciseSets?: ExerciseSet[] };

interface MetricConfig {
  readonly metric: PersonalRecordMetric;
  readonly label: string;
  readonly isImprovement: (current: number, previous: number) => boolean;
}

const METRICS: readonly MetricConfig[] = [
  { metric: "maxWeight", label: "Max weight", isImprovement: (current, previous) => current > previous },
  { metric: "maxDistance", label: "Max distance", isImprovement: (current, previous) => current > previous },
  { metric: "bestTime", label: "Best time", isImprovement: (current, previous) => current < previous },
  { metric: "estimated1RM", label: "Estimated 1RM", isImprovement: (current, previous) => current > previous },
];

function getExerciseKey(set: Pick<ExerciseSet, "exerciseName" | "customLabel">): string {
  return set.exerciseName === "custom" && set.customLabel
    ? `custom:${set.customLabel}`
    : set.exerciseName;
}

function toLoggedSets(workout: CreatedWorkoutWithSets): ExerciseSetWithDate[] {
  if (!workout.exerciseSets || workout.exerciseSets.length === 0) return [];
  return workout.exerciseSets.map((set) => ({
    ...set,
    workoutLogId: set.workoutLogId ?? workout.id,
    date: workout.date,
  }));
}

function getMetricValue(record: PersonalRecord, metric: PersonalRecordMetric) {
  return record[metric];
}

export function findPersonalRecordAchievements(
  priorSets: ExerciseSetWithDate[],
  createdWorkout: CreatedWorkoutWithSets,
): PersonalRecordAchievement[] {
  const createdSets = toLoggedSets(createdWorkout);
  if (createdSets.length === 0 || priorSets.length === 0) return [];

  const priorRecords = calculatePersonalRecords(priorSets);
  const createdRecords = calculatePersonalRecords(createdSets);
  const createdSetByKey = new Map(createdSets.map((set) => [getExerciseKey(set), set]));
  const achievements: PersonalRecordAchievement[] = [];

  for (const [exerciseKey, createdRecord] of Object.entries(createdRecords)) {
    const priorRecord = priorRecords[exerciseKey];
    if (!priorRecord) continue;
    const representativeSet = createdSetByKey.get(exerciseKey);
    if (!representativeSet) continue;

    for (const { metric, label, isImprovement } of METRICS) {
      const current = getMetricValue(createdRecord, metric);
      const previous = getMetricValue(priorRecord, metric);
      if (!current || !previous || !isImprovement(current.value, previous.value)) continue;

      achievements.push({
        exerciseKey,
        exerciseName: representativeSet.exerciseName,
        customLabel: representativeSet.customLabel,
        category: representativeSet.category,
        metric,
        metricLabel: label,
        value: current.value,
        previousValue: previous.value,
        date: current.date,
        workoutLogId: current.workoutLogId,
      });
    }
  }

  return achievements;
}
