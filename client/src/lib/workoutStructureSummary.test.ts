import { describe, expect, it } from "vitest";

import { serializeWorkoutStructure } from "./workoutStructureSummary";

// exercise_sets.distance is stored in the athlete's own unit, so the summary
// requires the preference rather than assuming metric (audit H16).
const KM = { distanceUnit: "km" } as const;
const MILES = { distanceUnit: "miles" } as const;

describe("serializeWorkoutStructure", () => {
  it("returns null for empty input", () => {
    expect(serializeWorkoutStructure([], KM)).toBeNull();
    expect(serializeWorkoutStructure(null, KM)).toBeNull();
  });

  it("groups legacy rows by contiguous exercise labels and preserves step flow", () => {
    const summary = serializeWorkoutStructure([
      { exerciseName: "back_squat", setNumber: 1, reps: 5 },
      { exerciseName: "back_squat", setNumber: 2, reps: 5 },
      { exerciseName: "rowing", setNumber: 1, distance: 500 },
      { exerciseName: "back_squat", setNumber: 1, reps: 3 },
    ] as never, KM);

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
    ] as never, KM);

    expect(summary).toContain("rest 30s");
    expect(summary).toContain("cue: smooth pace");
    expect(summary).toContain("S2 Rowing (250m)");
  });

  it("labels a miles athlete's stored distance as feet, not metres", () => {
    const rows = [{ exerciseName: "rowing", setNumber: 1, distance: 1312 }] as never;

    // 1312 is what a 400 m row stores for a miles athlete: feet. Rendering it
    // as "1312m" overstated the distance 3.28x under the wrong label (H16).
    expect(serializeWorkoutStructure(rows, MILES)).toContain("(1312ft)");
    expect(serializeWorkoutStructure(rows, MILES)).not.toContain("1312m");
  });

  it("renders a sub-minute time target as seconds rather than a fraction", () => {
    // A 45-second step now reaches the minutes column as 0.75 (audit C7);
    // "0.75min" is not a thing anyone reads.
    const rows = [{ exerciseName: "rowing", setNumber: 1, time: 0.75 }] as never;
    expect(serializeWorkoutStructure(rows, KM)).toContain("(45s)");
  });

  it("still renders a whole-minute time target in minutes", () => {
    const rows = [{ exerciseName: "rowing", setNumber: 1, time: 12 }] as never;
    expect(serializeWorkoutStructure(rows, KM)).toContain("(12min)");
  });
});
