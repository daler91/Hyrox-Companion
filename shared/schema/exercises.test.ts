import { describe, expect, it } from "vitest";

import { EXERCISE_DEFINITIONS, normalizeExerciseName } from "./exercises";

describe("exercise catalog", () => {
  it("includes common gym movements", () => {
    expect(EXERCISE_DEFINITIONS.leg_press.label).toBe("Leg Press");
    expect(EXERCISE_DEFINITIONS.seated_cable_row.label).toBe("Seated Cable Row");
    expect(EXERCISE_DEFINITIONS.dumbbell_bench_press.label).toBe("Dumbbell Bench Press");
    expect(EXERCISE_DEFINITIONS.machine_shoulder_press.label).toBe("Machine Shoulder Press");
    expect(EXERCISE_DEFINITIONS.t_bar_row.label).toBe("T-Bar Row");
    expect(EXERCISE_DEFINITIONS.jump_rope.label).toBe("Jump Rope");
  });
});

describe("normalizeExerciseName", () => {
  it("returns canonical names when already valid", () => {
    expect(normalizeExerciseName("back_squat")).toBe("back_squat");
  });

  it("normalizes common aliases", () => {
    expect(normalizeExerciseName("RDL")).toBe("romanian_deadlift");
    expect(normalizeExerciseName("db bench")).toBe("dumbbell_bench_press");
    expect(normalizeExerciseName("Lat Pull-Down")).toBe("lat_pulldown");
    expect(normalizeExerciseName("tricep pushdowns")).toBe("triceps_pushdown");
    expect(normalizeExerciseName("machine chest press")).toBe("chest_press_machine");
    expect(normalizeExerciseName("tbar row")).toBe("t_bar_row");
  });

  it("returns null for unknown names", () => {
    expect(normalizeExerciseName("made up movement xyz")).toBeNull();
  });
});
