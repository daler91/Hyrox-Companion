import { describe, expect, it } from "vitest";

import type { StructuredExercise } from "@/components/ExerciseInput";

import { buildWorkoutSavePayload } from "./saveWorkoutPayload";

const baseInput = {
  title: "",
  date: "2026-04-25",
  freeText: "",
  notes: "",
  rpe: null,
  durationMinutes: "",
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

  it("includes an optional workout duration when provided", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      freeText: "5k easy run",
      durationMinutes: "47",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.duration).toBe(47);
  });

  it("converts a manually entered distance (km) to meters", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      freeText: "easy run",
      distance: "5",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.distanceMeters).toBe(5000);
  });

  it("converts a manually entered distance (miles) to meters", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      distanceUnit: "miles",
      freeText: "easy run",
      distance: "3.1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.distanceMeters).toBe(4989);
  });

  it("parses manually entered average and max heart rate", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      freeText: "easy run",
      avgHeartrate: "145",
      maxHeartrate: "178",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.avgHeartrate).toBe(145);
    expect(result.payload.maxHeartrate).toBe(178);
  });

  it("omits distance and heart rate when not entered", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      freeText: "easy run",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.distanceMeters).toBeUndefined();
    expect(result.payload.avgHeartrate).toBeUndefined();
    expect(result.payload.maxHeartrate).toBeUndefined();
  });

  it("treats non-numeric or negative distance as not entered", () => {
    for (const distance of ["abc", "-5"]) {
      const result = buildWorkoutSavePayload({
        ...baseInput,
        freeText: "easy run",
        distance,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.distanceMeters).toBeUndefined();
    }
  });

  it("rejects an out-of-range heart rate before saving", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      freeText: "easy run",
      avgHeartrate: "300",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.description).toMatch(/heart rate/i);
  });

  it("rejects a max heart rate below the average before saving", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      freeText: "easy run",
      avgHeartrate: "180",
      maxHeartrate: "150",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.description).toMatch(/max heart rate/i);
  });

  it("rejects a distance above the server cap before saving", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      freeText: "easy run",
      distance: "2000", // 2000 km -> 2,000,000 m, over the 1,000,000 m cap
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.description).toMatch(/distance/i);
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

  it("persists explicit exercise rows as the source for linked block work steps", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      title: "EMOM rows",
      exerciseBlocks: ["row-1"],
      exerciseData: {
        "row-1": {
          exerciseName: "wall_balls",
          customLabel: null,
          category: "conditioning",
          sets: [{
            setNumber: 1,
            reps: 12,
            blockId: "block-emom",
            stepNumber: 1,
            intervalMinute: 1,
            stepRole: "work",
          }],
        } as StructuredExercise,
      },
      structureBlocks: [{
        id: "block-emom",
        sectionType: "main",
        formatType: "emom",
        durationMinutes: 10,
        steps: [{ stepNumber: 1, minuteIndex: 1, stepType: "work", exerciseName: "Unassigned exercise" }],
      }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.exercises?.[0].sets[0]).toMatchObject({
      blockId: "block-emom",
      stepNumber: 1,
      intervalMinute: 1,
      stepRole: "work",
      reps: 12,
    });
    expect(result.payload.structureBlocks?.[0].steps[0]).toMatchObject({
      exerciseName: "wall_balls",
      category: "conditioning",
      targets: { targetReps: 12 },
    });
  });

  it("preserves canonical exerciseName when linked rows have custom labels", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      title: "Labeled canonical row",
      exerciseBlocks: ["row-1"],
      exerciseData: {
        "row-1": {
          exerciseName: "back_squat",
          customLabel: "Tempo Squat",
          category: "strength",
          sets: [{ setNumber: 1, reps: 5, blockId: "block-rounds", stepNumber: 1 }],
        },
      },
      structureBlocks: [{
        id: "block-rounds",
        sectionType: "main",
        formatType: "rounds",
        roundCount: 3,
        steps: [{ stepNumber: 1, stepType: "work", exerciseName: "Unassigned exercise" }],
      }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.structureBlocks?.[0].steps[0]).toMatchObject({
      exerciseName: "back_squat",
      customLabel: "Tempo Squat",
    });
  });

  it("links legacy per-exercise structure configs to the exercise row", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      title: "Legacy row structure",
      exerciseBlocks: ["row-1"],
      exerciseData: {
        "row-1": {
          exerciseName: "wall_balls",
          category: "conditioning",
          sets: [{ setNumber: 1, reps: 12 }],
          structure: {
            section: "main",
            blockType: "emom",
            emomDurationMinutes: 10,
            steps: [{ id: "step-1", type: "work", exercise: "wall_balls" }],
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const blockId = result.payload.structureBlocks?.[0].id;
    expect(blockId).toEqual(expect.any(String));
    expect(result.payload.exercises?.[0].sets[0]).toMatchObject({
      blockId,
      stepNumber: 1,
      intervalMinute: 1,
    });
  });

  it("blocks saves when complex block work steps have no linked exercise row", () => {
    const result = buildWorkoutSavePayload({
      ...baseInput,
      title: "Unlinked EMOM",
      exerciseBlocks: ["row-1"],
      exerciseData: {
        "row-1": {
          exerciseName: "wall_balls",
          category: "conditioning",
          sets: [{ setNumber: 1, reps: 12 }],
        },
      },
      structureBlocks: [{
        id: "block-emom",
        sectionType: "main",
        formatType: "emom",
        durationMinutes: 10,
        steps: [{ stepNumber: 1, minuteIndex: 1, stepType: "work", exerciseName: "Unassigned exercise" }],
      }],
    });

    expect(result).toEqual({
      ok: false,
      description: "EMOM step 1 must be linked to an exercise row.",
    });
  });

  it("converts legacy emom exercise rows before persisting payload", () => {
    const legacyExercise: StructuredExercise = {
      exerciseName: "emom",
      category: "conditioning",
      sets: [{ setNumber: 1, time: 12 }],
    };
    const result = buildWorkoutSavePayload({
      ...baseInput,
      title: "Legacy",
      exerciseBlocks: ["block-1"],
      exerciseData: {
        "block-1": legacyExercise,
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
