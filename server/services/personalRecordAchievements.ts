import type {
  ExerciseSet,
  PersonalRecord,
  PersonalRecordAchievement,
  PersonalRecordMetric,
  PersonalRecordValue,
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

// One metric on which `newRecords` beats `priorRecords` — the unit of "a PR was
// set". `config` carries the metric id, label, and its better-is direction.
interface RecordImprovement {
  exerciseKey: string;
  config: MetricConfig;
  current: PersonalRecordValue;
  previous: PersonalRecordValue;
}

// Compare two PR maps and return every metric where `newRecords` improves on
// `priorRecords`. An exercise absent from `priorRecords` (first-ever log) and a
// metric with no prior value are intentionally NOT improvements: a PR is
// beating a previous best, not establishing the first one. Shared by the
// per-workout achievement feed and the weekly-summary PR count so the two can
// never disagree on what counts as a PR.
function findRecordImprovements(
  priorRecords: Record<string, PersonalRecord>,
  newRecords: Record<string, PersonalRecord>,
): RecordImprovement[] {
  const improvements: RecordImprovement[] = [];
  for (const [exerciseKey, newRecord] of Object.entries(newRecords)) {
    const priorRecord = priorRecords[exerciseKey];
    if (!priorRecord) continue;
    for (const config of METRICS) {
      const current = getMetricValue(newRecord, config.metric);
      const previous = getMetricValue(priorRecord, config.metric);
      if (!current || !previous || !config.isImprovement(current.value, previous.value)) continue;
      improvements.push({ exerciseKey, config, current, previous });
    }
  }
  return improvements;
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

  for (const { exerciseKey, config, current, previous } of findRecordImprovements(priorRecords, createdRecords)) {
    const representativeSet = createdSetByKey.get(exerciseKey);
    if (!representativeSet) continue;

    achievements.push({
      exerciseKey,
      exerciseName: representativeSet.exerciseName,
      customLabel: representativeSet.customLabel,
      category: representativeSet.category,
      metric: config.metric,
      metricLabel: config.label,
      value: current.value,
      previousValue: previous.value,
      date: current.date,
      workoutLogId: current.workoutLogId,
    });
  }

  return achievements;
}

// Count personal records set within [rangeStartStr, rangeEndStr] (inclusive,
// YYYY-MM-DD): metrics whose best INSIDE the range beats the user's best from
// strictly BEFORE it. Reuses findRecordImprovements, so it counts exactly what
// the per-workout achievement feed calls a PR — a brand-new exercise with no
// prior history is a baseline, not a PR, so it isn't counted. Multiple
// improvements to the same metric within the range collapse to one (the range's
// single best vs the prior best). Sets dated after the range are ignored, so a
// summary about last week isn't perturbed by workouts logged since. Powers the
// weekly-summary email's "New PRs" stat (W18).
export function countPersonalRecordsInRange(
  allSets: ExerciseSetWithDate[],
  rangeStartStr: string,
  rangeEndStr: string,
): number {
  const priorSets: ExerciseSetWithDate[] = [];
  const rangeSets: ExerciseSetWithDate[] = [];
  for (const set of allSets) {
    if (set.date < rangeStartStr) priorSets.push(set);
    else if (set.date <= rangeEndStr) rangeSets.push(set);
  }
  if (rangeSets.length === 0) return 0;

  const priorRecords = calculatePersonalRecords(priorSets);
  const rangeRecords = calculatePersonalRecords(rangeSets);
  return findRecordImprovements(priorRecords, rangeRecords).length;
}
