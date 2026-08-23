import type { ExerciseSet } from "@shared/schema";

export function makeExerciseSet(overrides: Partial<ExerciseSet> = {}): ExerciseSet {
  return {
    id: "set-1",
    workoutLogId: "log-1",
    planDayId: null,
    exerciseName: "back_squat",
    customLabel: null,
    category: "strength",
    setNumber: 1,
    reps: 8,
    weight: 60,
    // Legacy by default (units NULL): the value means "60 in whatever the
    // athlete's display unit is", which is what every test written before the
    // L4 unit stamp assumes. A test that wants a stamped row opts in with
    // weightUnit: "kg" | "lbs" and distanceUnit: "m" | "ft".
    weightUnit: null,
    distance: null,
    distanceUnit: null,
    time: null,
    plannedReps: null,
    plannedWeight: null,
    plannedDistance: null,
    plannedTime: null,
    blockId: null,
    stepNumber: null,
    intervalMinute: null,
    cycleNumber: null,
    stepRole: null,
    groupId: null,
    intensity: null,
    load: null,
    repMode: null,
    tempo: null,
    standards: null,
    notes: null,
    confidence: 95,
    sortOrder: 0,
    version: 1,
    ...overrides,
  };
}
