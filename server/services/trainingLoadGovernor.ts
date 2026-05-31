import type { InsertExerciseSet, TrainingLoadOverview, WorkoutSuggestion } from "@shared/schema";

import {
  daysBetween,
  type LoadGovernorSuggestion,
  type PromptExerciseForLoad,
  toIsoDate,
  type UpcomingWorkoutForLoad,
} from "./trainingLoadService";

// Re-export the suggestion type so consumers can import it alongside the builder.
export type { LoadGovernorSuggestion } from "./trainingLoadService";

// Load Governor — turns a TrainingLoadOverview + upcoming workouts into coaching
// suggestions (downshifting risky sessions, ACWR on-ramps, etc.). Extracted from
// trainingLoadService.ts (review L5) so the core load *calculation* and the
// *suggestion* generation live in focused, separately-testable modules.

function workoutText(workout: UpcomingWorkoutForLoad): string {
  return [workout.focus, workout.mainWorkout, workout.accessory ?? "", workout.notes ?? ""].join(" ").toLowerCase();
}

function hasExercise(workout: UpcomingWorkoutForLoad, names: readonly string[]): boolean {
  const nameSet = new Set(names);
  return Boolean(workout.exerciseDetails?.some((exercise) => nameSet.has(exercise.exerciseName)));
}

function isRunningWorkout(workout: UpcomingWorkoutForLoad): boolean {
  return Boolean(workout.exerciseDetails?.some((exercise) => exercise.category === "running")) || /\brun|sprint|track|tempo|threshold|hill\b/.test(workoutText(workout));
}

function isStrengthWorkout(workout: UpcomingWorkoutForLoad): boolean {
  return Boolean(workout.exerciseDetails?.some((exercise) => exercise.category === "strength")) || /\b(squat|deadlift|lunge|leg press|sled|strength)\b/.test(workoutText(workout));
}

function isHighTaxStrengthWorkout(workout: UpcomingWorkoutForLoad): boolean {
  return isStrengthWorkout(workout) &&
    (hasExercise(workout, [
      "deadlift",
      "romanian_deadlift",
      "good_morning",
      "back_squat",
      "front_squat",
      "leg_press",
      "lunges",
      "bulgarian_split_squat",
      "sled_push",
      "sandbag_lunges",
    ]) ||
      /\b(heavy|max|1rm|90%|failure|amrap|high[-\s]?volume|hard|threshold)\b/.test(workoutText(workout)));
}

function isHighIntensityRun(workout: UpcomingWorkoutForLoad): boolean {
  return hasExercise(workout, ["interval_run", "hill_repeats", "tempo_run", "fartlek_run", "sprints", "treadmill_intervals"]) ||
    /\b(sprint|interval|track|hill|threshold|tempo|zone\s*[45]|z[45]|race pace)\b/.test(workoutText(workout));
}

function isBrakingRun(workout: UpcomingWorkoutForLoad): boolean {
  return hasExercise(workout, ["long_run"]) || /\b(downhill|long run|road run|hard descent)\b/.test(workoutText(workout));
}

function isPlyoOrSpeed(workout: UpcomingWorkoutForLoad): boolean {
  return isHighIntensityRun(workout) || hasExercise(workout, ["box_jumps", "burpee_broad_jump", "jump_rope"]);
}

function firstRunExercise(workout: UpcomingWorkoutForLoad): PromptExerciseForLoad | undefined {
  return workout.exerciseDetails?.find((exercise) => exercise.category === "running");
}

function buildEasyRunRows(planDayId: string, workout: UpcomingWorkoutForLoad): InsertExerciseSet[] {
  const run = firstRunExercise(workout);
  return [{
    planDayId,
    workoutLogId: null,
    exerciseName: "recovery_run",
    customLabel: null,
    category: "running",
    setNumber: 1,
    reps: null,
    weight: null,
    distance: run?.distance ?? null,
    time: run?.time ?? null,
    plannedReps: null,
    plannedWeight: null,
    plannedDistance: null,
    plannedTime: null,
    notes: "Load governor downshift: flat, low-intensity aerobic session.",
    confidence: 95,
    sortOrder: 0,
  }];
}

function easyRunRecommendation(workout: UpcomingWorkoutForLoad): string {
  const run = firstRunExercise(workout);
  const details = [
    "Flat low-intensity aerobic run",
    run?.time ? `${run.time} min` : null,
    run?.distance ? `${Math.round(run.distance)} m` : null,
  ].filter(Boolean);
  return `${details.join(" - ")}. Keep effort conversational and avoid hills, sprints, track work, and downhill braking.`;
}

// Every governor downshift swaps the session for a flat, low-intensity
// recovery run, so the converted day's title becomes this. Used to rename the
// `focus` (title) field and to contrast against the original prescription.
const RECOVERY_RUN_FOCUS = "Recovery Run";

function buildSuggestion(
  workout: UpcomingWorkoutForLoad,
  rationale: string,
  rationaleCode: string,
  priority: WorkoutSuggestion["priority"] = "high",
): LoadGovernorSuggestion {
  return {
    rationaleCode,
    focusOverride: RECOVERY_RUN_FOCUS,
    suggestion: {
      workoutId: workout.id,
      workoutDate: workout.date,
      workoutFocus: workout.focus,
      targetField: "mainWorkout",
      action: "replace",
      recommendation: easyRunRecommendation(workout),
      rationale,
      priority,
    },
    structuredSetRows: workout.exerciseDetails?.length ? buildEasyRunRows(workout.id, workout) : undefined,
  };
}

function restrictionIds(summary: TrainingLoadOverview): Set<string> {
  return new Set(summary.activeRestrictions.map((restriction) => restriction.id));
}

interface SuggestionRule {
  readonly restrictionId: string; readonly maxDaysAhead: number;
  readonly matches: (workout: UpcomingWorkoutForLoad) => boolean; readonly rationale: (summary: TrainingLoadOverview) => string;
  readonly priority?: WorkoutSuggestion["priority"];
}

function canApplySuggestionRule(
  rule: SuggestionRule,
  restrictions: Set<string>,
  currentDate: string,
  workout: UpcomingWorkoutForLoad,
  usedWorkoutIds: ReadonlySet<string>,
): boolean {
  const daysAhead = daysBetween(currentDate, workout.date);
  return restrictions.has(rule.restrictionId) &&
    !usedWorkoutIds.has(workout.id) &&
    daysAhead >= 0 &&
    daysAhead <= rule.maxDaysAhead &&
    rule.matches(workout);
}

function applySuggestionRules(
  summary: TrainingLoadOverview,
  workouts: readonly UpcomingWorkoutForLoad[],
  rules: readonly SuggestionRule[],
  currentDate: string,
  usedWorkoutIds: Set<string>,
  suggestions: LoadGovernorSuggestion[],
): void {
  const restrictions = restrictionIds(summary);
  for (const workout of workouts) {
    const rule = rules.find((candidate) => canApplySuggestionRule(candidate, restrictions, currentDate, workout, usedWorkoutIds));
    if (!rule) continue;
    suggestions.push(buildSuggestion(workout, rule.rationale(summary), rule.restrictionId, rule.priority));
    usedWorkoutIds.add(workout.id);
  }
}

function applyOnrampSuggestions(
  summary: TrainingLoadOverview,
  workouts: readonly UpcomingWorkoutForLoad[],
  currentDate: string,
  usedWorkoutIds: Set<string>,
  suggestions: LoadGovernorSuggestion[],
): void {
  const restrictions = restrictionIds(summary);
  const rule: SuggestionRule = {
    restrictionId: "acwr_onramp",
    maxDaysAhead: 3,
    matches: (candidate) => isHighIntensityRun(candidate) || isStrengthWorkout(candidate),
    rationale: () =>
      "Recent training load is below the 28-day baseline, so this session starts a 3-day on-ramp instead of jumping straight back to peak load.",
    priority: "medium",
  };
  let onrampCount = 0;
  for (const workout of workouts) {
    if (onrampCount >= 3) return;
    if (!canApplySuggestionRule(rule, restrictions, currentDate, workout, usedWorkoutIds)) continue;
    suggestions.push(buildSuggestion(workout, rule.rationale(summary), rule.restrictionId, rule.priority));
    usedWorkoutIds.add(workout.id);
    onrampCount += 1;
  }
}

export function buildLoadGovernorSuggestions(
  summary: TrainingLoadOverview,
  upcomingWorkouts: readonly UpcomingWorkoutForLoad[],
  currentDate = toIsoDate(new Date()),
): LoadGovernorSuggestion[] {
  const suggestions: LoadGovernorSuggestion[] = [];
  const usedWorkoutIds = new Set<string>();
  // ⚡ Bolt Performance Optimization:
  // Fast string comparison for YYYY-MM-DD dates instead of localeCompare.
  // Avoids unnecessary overhead since ISO dates sort lexicographically.
  const ordered = [...upcomingWorkouts].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return 0;
  });

  applySuggestionRules(summary, ordered, [
    { restrictionId: "posterior_chain_velocity_lock", maxDaysAhead: 2,
      matches: (workout) => isRunningWorkout(workout) && isHighIntensityRun(workout),
      rationale: () =>
        "Gym log shows high posterior-chain strain, so this high-velocity run is downshifted to protect hamstrings while preserving aerobic volume.",
    },
    { restrictionId: "anterior_chain_braking_guard", maxDaysAhead: 3,
      matches: (workout) => isRunningWorkout(workout) && (isBrakingRun(workout) || isHighIntensityRun(workout)),
      rationale: () =>
        "Gym log shows high quad and patellar strain, so this run is shifted to a flat low-intensity session to reduce knee braking load.",
    },
    { restrictionId: "elastic_tendon_speed_guard", maxDaysAhead: 3,
      matches: isPlyoOrSpeed,
      rationale: () =>
        "Seven-day elastic tendon load is high, so speed and plyometric work is downshifted to protect the Achilles and plantar fascia.",
    },
  ], currentDate, usedWorkoutIds, suggestions);
  applySuggestionRules(summary, ordered, [{
    restrictionId: "acwr_yellow_guard", maxDaysAhead: 2,
    matches: (workout) => isHighIntensityRun(workout) || isHighTaxStrengthWorkout(workout),
    rationale: (loadSummary) =>
      `ACWR is ${loadSummary.acwr ?? "above target"}, so this higher-tax session is softened while acute load settles back toward the chronic baseline.`,
    priority: "medium",
  }], currentDate, usedWorkoutIds, suggestions);
  applySuggestionRules(summary, ordered, [{
    restrictionId: "acwr_danger_lock", maxDaysAhead: 4,
    matches: (workout) => isHighIntensityRun(workout) || isStrengthWorkout(workout),
    rationale: (loadSummary) =>
      `ACWR is ${loadSummary.acwr ?? "above target"}, so high-intensity training is downshifted to guide load back toward the chronic baseline.`,
  }], currentDate, usedWorkoutIds, suggestions);
  applyOnrampSuggestions(summary, ordered, currentDate, usedWorkoutIds, suggestions);

  return suggestions;
}
