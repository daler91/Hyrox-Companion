import { describe, expect, it } from "vitest";

import type { StructuredExercise } from "@/components/ExerciseInput";

import { buildWorkoutSavePayload } from "./saveWorkoutPayload";

const baseInput = {
  title: "",
  date: "2026-04-25",
  freeText: "",
  notes: "",
  rpe: null,
  exerciseBlocks: [],
  exerciseData: {},
  weightLabel: "kg",
  distanceUnit: "km",
};

describe("buildWorkoutSavePayload", () => {
  it("requires either structured exercises or free text", () => {
    const result = buildWorkoutSavePayload(baseInput);

    expect(result).toEqual({
      ok: false,
      description: "Please add an exercise or describe your workout.",
    });
  });

  it("builds a text-only workout payload with the fallback title", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      freeText: "5k easy run",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      title: "Workout",
      focus: "Workout",
      mainWorkout: "5k easy run",
      notes: null,
      rpe: null,
    });
  });

  it("uses structured blocks and reports missing-field warnings", () => {
    const exercise: StructuredExercise = {
      exerciseName: "custom",
      customLabel: "Sandbag Lunges",
      category: "conditioning",
      sets: [{ setNumber: 1 }],
    };
    const result = buildWorkoutSavePayload({
      ...baseInput,
      title: "HYROX Prep",
      exerciseBlocks: ["block-1"],
      exerciseData: { "block-1": exercise },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual(["Sandbag Lunges is missing reps"]);
    expect(result.payload.exercises).toHaveLength(1);
  });

  it("includes structureBlocks when editor structure is present", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      title: "HYROX Blocks",
      freeText: "EMOM builder",
      structureBlocks: [{
        sectionType: "main",
        formatType: "emom",
        sequenceOrder: 0,
        durationMinutes: 12,
        steps: [{ stepNumber: 1, stepType: "work", minuteIndex: 1, exerciseName: "burpees", targets: { targetReps: 10 } }],
      }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.structureBlocks).toHaveLength(1);
    expect(result.payload.structureBlocks?.[0]).toMatchObject({
      sectionType: "main",
      formatType: "emom",
    });
  });

  it("does not emit fixed rounds for amrap blocks from exercise structure", () => {
    const exercise: StructuredExercise = {
      exerciseName: "burpees",
      category: "conditioning",
      sets: [{ setNumber: 1, reps: 10 }],
      structure: {
        section: "main",
        blockType: "amrap",
        rounds: 5,
        steps: [{ id: "s1", type: "work", exercise: "burpees", target: "10 reps" }],
      },
    };
    const result = buildWorkoutSavePayload({
      ...baseInput,
      title: "AMRAP Session",
      exerciseBlocks: ["b1"],
      exerciseData: { b1: exercise },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.structureBlocks?.[0]).toMatchObject({ formatType: "amrap" });
    expect(result.payload.structureBlocks?.[0]?.rounds).toBeUndefined();
  });
});
