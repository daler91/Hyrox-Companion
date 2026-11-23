import { describe, expect, it } from "vitest";

import { makeDraftExerciseSet } from "./draftExerciseSet";

// CH-draftSet (REFACTORING_REVIEW 2026-09-23): the one draft-row literal that
// AdhocLogSheet and DraftExerciseTable both build from.
describe("makeDraftExerciseSet", () => {
  it("stores every omitted field as null on an unsaved, unit-less row", () => {
    expect(
      makeDraftExerciseSet({ id: "row-1", exerciseName: "back_squat", category: "strength", setNumber: 1, sortOrder: 0 }),
    ).toEqual({
      id: "row-1",
      workoutLogId: null,
      planDayId: null,
      exerciseName: "back_squat",
      customLabel: null,
      category: "strength",
      setNumber: 1,
      reps: null,
      weight: null,
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
      confidence: null,
      sortOrder: 0,
      version: 1,
    });
  });

  it("keeps the values it is given", () => {
    const row = makeDraftExerciseSet({
      id: "row-2",
      exerciseName: "custom",
      customLabel: "Sled push",
      category: "functional",
      setNumber: 3,
      sortOrder: 7,
      reps: 10,
      weight: 60,
      distance: 50,
      time: 4,
      plannedTime: 5,
      notes: "heavy",
      confidence: 0.9,
      repMode: "each_side",
    });

    expect(row).toMatchObject({
      customLabel: "Sled push",
      setNumber: 3,
      sortOrder: 7,
      reps: 10,
      weight: 60,
      distance: 50,
      time: 4,
      plannedTime: 5,
      notes: "heavy",
      confidence: 0.9,
      repMode: "each_side",
      weightUnit: null,
      distanceUnit: null,
    });
  });
});
