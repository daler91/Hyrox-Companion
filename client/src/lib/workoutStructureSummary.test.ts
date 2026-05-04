import { describe, expect, it } from "vitest";

import { serializeWorkoutStructure } from "./workoutStructureSummary";

describe("serializeWorkoutStructure", () => {
  it("returns null for empty input", () => {
    expect(serializeWorkoutStructure([])).toBeNull();
    expect(serializeWorkoutStructure(null)).toBeNull();
  });

  it("groups legacy rows by contiguous exercise labels and preserves step flow", () => {
    const summary = serializeWorkoutStructure([
      { exerciseName: "back_squat", setNumber: 1, reps: 5 },
      { exerciseName: "back_squat", setNumber: 2, reps: 5 },
      { exerciseName: "rowing", setNumber: 1, distance: 500 },
      { exerciseName: "back_squat", setNumber: 1, reps: 3 },
    ] as never);

    expect(summary).toBe("S1 Back Squat (5 reps) → S2 Back Squat (5 reps) | S1 Rowing (500m) | S1 Back Squat (3 reps)");
  });

  it("includes rest/cue metadata for block-based rows", () => {
    const summary = serializeWorkoutStructure([
      {
        exerciseName: "custom",
        customLabel: "Sandbag Lunge",
        setNumber: 1,
        reps: 12,
        blockId: "block-a",
        stepNumber: 1,
        notes: "smooth pace",
        intensity: { restSeconds: 30 },
      },
      {
        exerciseName: "rowing",
        setNumber: 1,
        distance: 250,
        blockId: "block-a",
        stepNumber: 2,
      },
    ] as never);

    expect(summary).toContain("rest 30s");
    expect(summary).toContain("cue: smooth pace");
    expect(summary).toContain("S2 Rowing (250m)");
  });
});
