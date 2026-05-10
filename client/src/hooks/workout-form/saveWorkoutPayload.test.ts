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
        durationMinutes: 12,
        steps: [{ stepNumber: 1, minuteIndex: 1, stepType: "work", exerciseName: "Burpee Broad Jump", targets: { instructions: "10 reps" } }],
      }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.structureBlocks).toHaveLength(1);
    expect(result.payload.structureBlocks?.[0]).toMatchObject({
      sectionType: "main",
      formatType: "emom",
      durationMinutes: 12,
    });
  });

  it("allows saving a block-only AMRAP workout", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      title: "AMRAP",
      structureBlocks: [{
        sectionType: "main",
        formatType: "amrap",
        timeCapMinutes: 10,
        steps: [{ stepNumber: 1, stepType: "work", exerciseName: "wall_balls", targets: { targetReps: 12 } }],
      }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.structureBlocks?.[0]).toMatchObject({ formatType: "amrap", timeCapMinutes: 10 });
  });
  it("converts legacy emom exercise rows before persisting payload", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      title: "Legacy",
      exerciseBlocks: ["block-1"],
      exerciseData: {
        "block-1": {
          exerciseName: "emom",
          category: "conditioning",
          sets: [{ setNumber: 1, time: 12 }],
        } as StructuredExercise,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.exercises?.[0]).toMatchObject({
      exerciseName: "custom",
      customLabel: "EMOM",
    });
  });

});
