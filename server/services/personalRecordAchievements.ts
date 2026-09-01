import type {
  ExerciseSet,
  PersonalRecord,
  PersonalRecordAchievement,
  PersonalRecordMetric,
  WorkoutLog,
} from "@shared/schema";
import type { UnitPreferences } from "@shared/unitConversion";

import { calculatePersonalRecords, type ExerciseSetWithDate, isTimePrImprovement } from "./analyticsService";

type CreatedWorkoutWithSets = WorkoutLog & { exerciseSets?: ExerciseSet[] };

interface MetricConfig {
  readonly metric: PersonalRecordMetric;
  readonly label: string;
  readonly isImprovement: (
    current: number,
    previous: number,
    exercise: Pick<ExerciseSet, "exerciseName" | "customLabel">,
  ) => boolean;
}

const METRICS: readonly MetricConfig[] = [
  { metric: "maxWeight", label: "Max weight", isImprovement: (current, previous) => current > previous },
  { metric: "maxDistance", label: "Max distance", isImprovement: (current, previous) => current > previous },
  // Time direction depends on the exercise: longer is better for isometric
  // holds (plank etc.), faster is better everywhere else — same rule
  // calculatePersonalRecords used to produce the records being compared. The
  // whole set is passed, not just the name: a custom-labelled hold carries
  // exerciseName "custom" and only `customLabel` says which exercise it is
  // (audit H4).
  { metric: "bestTime", label: "Best time", isImprovement: (current, previous, exercise) => isTimePrImprovement(exercise, current, previous) },
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
  preferences?: UnitPreferences,
): PersonalRecordAchievement[] {
  const createdSets = toLoggedSets(createdWorkout);
  if (createdSets.length === 0 || priorSets.length === 0) return [];

  // Both sides read through their unit stamps into the athlete's current unit,
  // so a 150 lb squat logged after a kg→lbs switch is compared against the
  // 100 kg (220 lb) history it actually has to beat — not celebrated as a PR.
  const priorRecords = calculatePersonalRecords(priorSets, preferences);
  const createdRecords = calculatePersonalRecords(createdSets, preferences);
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
      if (!current || !previous || !isImprovement(current.value, previous.value, representativeSet)) continue;

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
