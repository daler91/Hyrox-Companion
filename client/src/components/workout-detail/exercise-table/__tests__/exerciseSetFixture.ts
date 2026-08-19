import type { ExerciseSetWithDate } from "@/lib/api/exercises";

/**
 * A logged back-squat set, shared by the exercise-table suites so the
 * factory lives once (SonarCloud counts copy-pasted fixtures as duplication).
 */
export function makeLoggedSet(overrides: Partial<ExerciseSetWithDate> = {}): ExerciseSetWithDate {
  return {
    id: "set-1",
    exerciseName: "back_squat",
    category: "strength",
    setNumber: 1,
    date: "2026-06-01",
    workoutLogId: "w-old",
    customLabel: null,
    reps: 8,
    weight: 80,
    distance: null,
    time: null,
    ...overrides,
  } as ExerciseSetWithDate;
}
