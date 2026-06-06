import type { TrainingLoadOverview, TrainingLoadRestriction } from "@shared/schema";

import type { PromptExerciseForLoad, UpcomingWorkoutForLoad } from "./trainingLoadService";

// Shared fixtures for trainingLoadGovernor tests. The fixture date is held
// constant so every "X days ahead" boundary can be reasoned about without
// re-reading the system clock.
export const CURRENT_DATE = "2026-05-22";

export function restriction(
  id: string,
  overrides: Partial<TrainingLoadRestriction> = {},
): TrainingLoadRestriction {
  return {
    id,
    label: id,
    severity: "danger",
    expiresOn: null,
    rationale: `${id} rationale`,
    ...overrides,
  };
}

export function summary(
  restrictions: TrainingLoadRestriction[],
  overrides: Partial<TrainingLoadOverview> = {},
): TrainingLoadOverview {
  return {
    currentUtss: 50,
    acuteAvg: 50,
    chronicAvg: 50,
    acwr: 1.0,
    zone: "sweet_spot",
    flaggedVectors: [],
    activeRestrictions: restrictions,
    downshiftRationale: null,
    trend: [],
    ...overrides,
  };
}

export function workout(
  overrides: Partial<UpcomingWorkoutForLoad> & Pick<UpcomingWorkoutForLoad, "id" | "date">,
): UpcomingWorkoutForLoad {
  return {
    focus: "Run",
    mainWorkout: "",
    ...overrides,
  };
}

export function exercise(
  overrides: Partial<PromptExerciseForLoad> & { exerciseName: string },
): PromptExerciseForLoad {
  return {
    category: "running",
    ...overrides,
  };
}
