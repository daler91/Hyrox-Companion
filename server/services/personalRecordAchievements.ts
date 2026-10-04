import type {
  ExerciseSet,
  PersonalRecordAchievement,
  PersonalRecordMetric,
  PersonalRecordValue,
  WorkoutLog,
} from "@shared/schema";
import type { UnitPreferences } from "@shared/unitConversion";

import type { SlimLoggedExerciseSet } from "../storage/shared";
import {
  type ExerciseSetWithDate,
  isSameEffortSize,
  isTimePrImprovement,
  type PersonalRecordTally,
  tallyPersonalRecords,
} from "./analyticsService";

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
  // tallyPersonalRecords used to produce the records being compared. The
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

/**
 * The (new, previous) values a metric is judged on. One pair for most metrics.
 * For best time, one per size of effort the new workout shares with history:
 * a time only beats a time for the same distance, or the same reps, so a 250 m
 * piece is never measured against a 1000 m one — C1 (CODEBASE_ANALYSIS_2026-10-03).
 */
function comparableValues(
  metric: PersonalRecordMetric,
  exerciseKey: string,
  created: PersonalRecordTally,
  prior: PersonalRecordTally,
  exercise: Pick<ExerciseSet, "exerciseName" | "customLabel">,
): Array<[current: PersonalRecordValue, previous: PersonalRecordValue]> {
  if (metric !== "bestTime") {
    const current = created.records[exerciseKey]?.[metric];
    const previous = prior.records[exerciseKey]?.[metric];
    return current && previous ? [[current, previous]] : [];
  }

  const pairs: Array<[PersonalRecordValue, PersonalRecordValue]> = [];
  for (const sized of created.bestTimesBySize[exerciseKey] ?? []) {
    let previous: PersonalRecordValue | undefined;
    for (const candidate of prior.bestTimesBySize[exerciseKey] ?? []) {
      if (!isSameEffortSize(sized, candidate)) continue;
      if (!previous || isTimePrImprovement(exercise, candidate.best.value, previous.value)) previous = candidate.best;
    }
    if (previous) pairs.push([sized.best, previous]);
  }
  return pairs;
}

export function findPersonalRecordAchievements(
  // Slim projection (no jsonb columns, no notes/planned*/block fields): the
  // only prior-set field this function reads is workoutLogId/date/scalar
  // metrics, all of which tallyPersonalRecords already accepts via
  // SlimLoggedExerciseSet. Callers with the full LoggedExerciseSetWithDate
  // shape still satisfy this structurally.
  priorSets: SlimLoggedExerciseSet[],
  createdWorkout: CreatedWorkoutWithSets,
  preferences?: UnitPreferences,
): PersonalRecordAchievement[] {
  const createdSets = toLoggedSets(createdWorkout);
  if (createdSets.length === 0 || priorSets.length === 0) return [];

  // Both sides read through their unit stamps into the athlete's current unit,
  // so a 150 lb squat logged after a kg→lbs switch is compared against the
  // 100 kg (220 lb) history it actually has to beat — not celebrated as a PR.
  const prior = tallyPersonalRecords(priorSets, preferences);
  const created = tallyPersonalRecords(createdSets, preferences);
  const createdSetByKey = new Map(createdSets.map((set) => [getExerciseKey(set), set]));
  const achievements: PersonalRecordAchievement[] = [];

  for (const exerciseKey of Object.keys(created.records)) {
    if (!prior.records[exerciseKey]) continue;
    const representativeSet = createdSetByKey.get(exerciseKey);
    if (!representativeSet) continue;

    for (const { metric, label, isImprovement } of METRICS) {
      for (const [current, previous] of comparableValues(metric, exerciseKey, created, prior, representativeSet)) {
        if (!isImprovement(current.value, previous.value, representativeSet)) continue;

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
  }

  return achievements;
}
