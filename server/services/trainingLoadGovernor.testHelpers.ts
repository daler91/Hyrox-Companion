import type { TrainingLoadOverview, TrainingLoadRestriction } from "@shared/schema";

import { buildLoadGovernorSuggestions } from "./trainingLoadGovernor";
import type {
  LoadGovernorSuggestion,
  PromptExerciseForLoad,
  UpcomingWorkoutForLoad,
} from "./trainingLoadService";

// Shared fixtures for trainingLoadGovernor tests. The fixture date is held
// constant so every "X days ahead" boundary can be reasoned about without
// re-reading the system clock.
export const CURRENT_DATE = "2026-05-22";

/** ISO date `n` days after CURRENT_DATE (negative `n` ⇒ in the past). */
export function dayAhead(n: number): string {
  const d = new Date(`${CURRENT_DATE}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

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
    acwr: 1,
    zone: "sweet_spot",
    tsb: 0,
    monotony: null,
    strain: null,
    monotonyZone: "ok",
    trimp: null,
    tss: null,
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

/**
 * Compact wrapper around the system under test: builds an overview from the
 * given restrictions (+ optional overview overrides such as `acwr`) and runs
 * the governor pinned to `CURRENT_DATE`. Tests that need to exercise the
 * SUT's own "default to today" path should call buildLoadGovernorSuggestions
 * directly instead of going through this helper.
 */
export function runGovernor(
  restrictions: TrainingLoadRestriction[],
  workouts: UpcomingWorkoutForLoad[],
  overrides: Partial<TrainingLoadOverview> = {},
  currentDate: string = CURRENT_DATE,
): LoadGovernorSuggestion[] {
  return buildLoadGovernorSuggestions(summary(restrictions, overrides), workouts, currentDate);
}
