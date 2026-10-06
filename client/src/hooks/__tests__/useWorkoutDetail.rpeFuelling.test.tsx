import type { WorkoutLog } from "@shared/schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkoutDetail } from "@/hooks/useWorkoutDetail";
import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { EXERCISE_HISTORY_QUERY_PREFIX } from "@/lib/workoutInvalidation";

// Same isolation as useWorkoutDetail.countsAsTraining.test.tsx: the passthrough
// hands back the raw config, so onMutate and onSuccess are driven directly
// against a real QueryClient.
vi.mock("@/hooks/useApiMutation", async () =>
  (await import("@/test/support/workoutDetailHookMocks")).makeApiMutationPassthroughMock(),
);

vi.mock("@/lib/queryClient", async (importOriginal) =>
  (await import("@/test/support/workoutDetailHookMocks")).makeRealQueryClientMock(importOriginal),
);

vi.mock("@/lib/api", async (importOriginal) =>
  (await import("@/test/support/workoutDetailHookMocks")).makeWorkoutReadsApiMock(importOriginal),
);

const WORKOUT_ID = "workout-1";
const SESSION = QUERY_KEYS.nutritionSessionFuelling(WORKOUT_ID);
const DAY = QUERY_KEYS.nutritionDay("2026-09-15");
const RANGE = QUERY_KEYS.nutritionRange("2026-09-09", "2026-09-15");
const BLOCK = QUERY_KEYS.nutritionBlock("2026-08-17", "2026-09-15");
const MICROS = QUERY_KEYS.nutritionMicros("2026-09-15");

interface RpeVariables {
  rpe: number | null;
  forWorkoutId: string;
}

interface RpeMutationConfig {
  onMutate: (variables: RpeVariables) => { seq: number };
  onSuccess: (
    data: WorkoutLog,
    variables: RpeVariables,
    context: { seq: number },
  ) => Promise<unknown>;
}

function rpeConfigOf(mutation: unknown): RpeMutationConfig {
  return (mutation as { config: RpeMutationConfig }).config;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const isInvalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

// CL19 (CODEBASE_ANALYSIS_2026-10-03): the inline RPE sits beside the
// session's fuelling panel. The RPE sizes that session's targets, picks the
// day's primary session for the meal targets and weights the day's training
// load (the chips' periodised target, the Fuelling block), yet a save
// refreshed only the history and the timeline.
describe("useWorkoutDetail updateRpe refreshes the fuelling reads built from the RPE", () => {
  beforeEach(() => {
    queryClient.clear();
    for (const key of [SESSION, DAY, RANGE, BLOCK, MICROS]) queryClient.setQueryData(key, {});
  });

  it("marks the session's fuelling, the day, the chips and the block stale", async () => {
    const { result } = renderHook(() => useWorkoutDetail(WORKOUT_ID), { wrapper });
    const updateRpe = rpeConfigOf(result.current.updateRpe);
    const variables = { rpe: 8, forWorkoutId: WORKOUT_ID };

    const context = updateRpe.onMutate(variables);
    await updateRpe.onSuccess({ id: WORKOUT_ID, rpe: 8 } as WorkoutLog, variables, context);

    for (const key of [SESSION, DAY, RANGE, BLOCK]) expect(isInvalidated(key)).toBe(true);
    expect(isInvalidated(MICROS)).toBe(false);
  });

  // CL53 (CODEBASE_ANALYSIS_2026-10-03): the RPE weights the session's load,
  // which the training overview and the home summary under it chart.
  it("marks the training overview's load stale", async () => {
    queryClient.setQueryData(QUERY_KEYS.trainingOverview, {});
    queryClient.setQueryData(QUERY_KEYS.trainingSummary, {});
    const { result } = renderHook(() => useWorkoutDetail(WORKOUT_ID), { wrapper });
    const updateRpe = rpeConfigOf(result.current.updateRpe);
    const variables = { rpe: 8, forWorkoutId: WORKOUT_ID };

    const context = updateRpe.onMutate(variables);
    await updateRpe.onSuccess({ id: WORKOUT_ID, rpe: 8 } as WorkoutLog, variables, context);

    expect(isInvalidated(QUERY_KEYS.trainingOverview)).toBe(true);
    expect(isInvalidated(QUERY_KEYS.trainingSummary)).toBe(true);
  });
});

interface TimeOfDayMutationConfig {
  onSuccess: () => Promise<unknown>;
}

// CL19 (CODEBASE_ANALYSIS_2026-10-03): a manual log's session time picks the
// day's meal timing, which the day summary carries, yet a save refreshed only
// the timeline. Session fuelling windows only by a device start time, and the
// chips and the block read no time of day.
describe("useWorkoutDetail updateTimeOfDay refreshes the day summaries", () => {
  beforeEach(() => {
    queryClient.clear();
    for (const key of [SESSION, DAY, RANGE, BLOCK, MICROS]) queryClient.setQueryData(key, {});
  });

  it("marks the day stale and leaves the other fuelling reads alone", async () => {
    const { result } = renderHook(() => useWorkoutDetail(WORKOUT_ID), { wrapper });
    const updateTimeOfDay = (
      result.current.updateTimeOfDay as unknown as { config: TimeOfDayMutationConfig }
    ).config;

    await updateTimeOfDay.onSuccess();

    expect(isInvalidated(DAY)).toBe(true);
    for (const key of [SESSION, RANGE, BLOCK, MICROS]) expect(isInvalidated(key)).toBe(false);
  });

  // CL43 (CODEBASE_ANALYSIS_2026-10-03): the time orders two same-day sessions
  // in the "Last time" history.
  it("marks every exercise's history stale", async () => {
    const squatHistory = QUERY_KEYS.exerciseHistory("back_squat", 3);
    queryClient.setQueryData(squatHistory, []);
    const { result } = renderHook(() => useWorkoutDetail(WORKOUT_ID), { wrapper });
    const updateTimeOfDay = (
      result.current.updateTimeOfDay as unknown as { config: TimeOfDayMutationConfig }
    ).config;

    await updateTimeOfDay.onSuccess();

    expect(isInvalidated(squatHistory)).toBe(true);
  });
});

interface SetReplacementConfig {
  invalidateQueries?: readonly (readonly unknown[])[];
}

// CL19 (CODEBASE_ANALYSIS_2026-10-03): seeding from the plan, re-parsing the
// text and parsing a photo replace the sets the training load is computed
// from, so the day's periodised target, the chips and the block read a stale
// load until refreshed. Session fuelling reads no sets.
type WorkoutDetail = ReturnType<typeof useWorkoutDetail>;

describe("useWorkoutDetail set replacements refresh the load-derived fuelling reads", () => {
  it.each([
    ["seedFromPlan", (detail: WorkoutDetail) => detail.seedFromPlan],
    ["reparseFreeText", (detail: WorkoutDetail) => detail.reparseFreeText],
    ["reparseFromImage", (detail: WorkoutDetail) => detail.reparseFromImage],
  ] as const)("%s", (_name, mutationOf) => {
    const { result } = renderHook(() => useWorkoutDetail(WORKOUT_ID), { wrapper });
    const { invalidateQueries } = (
      mutationOf(result.current) as unknown as { config: SetReplacementConfig }
    ).config;

    expect(invalidateQueries).toEqual([
      QUERY_KEYS.workout(WORKOUT_ID),
      QUERY_KEYS.workoutHistory(WORKOUT_ID),
      QUERY_KEYS.nutritionDayPrefix,
      QUERY_KEYS.nutritionRangePrefix,
      QUERY_KEYS.nutritionBlockPrefix,
      // CL43 (CODEBASE_ANALYSIS_2026-10-03): the replaced sets feed "Last time".
      EXERCISE_HISTORY_QUERY_PREFIX,
    ]);
  });
});
