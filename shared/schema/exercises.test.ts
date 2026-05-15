import { describe, expect, it } from "vitest";

import { EXERCISE_DEFINITIONS, normalizeExerciseName } from "./exercises";

describe("exercise catalog", () => {
  it("includes common gym movements", () => {
    expect(EXERCISE_DEFINITIONS.leg_press.label).toBe("Leg Press");
    expect(EXERCISE_DEFINITIONS.seated_cable_row.label).toBe("Seated Cable Row");
    expect(EXERCISE_DEFINITIONS.dumbbell_bench_press.label).toBe("Dumbbell Bench Press");
    expect(EXERCISE_DEFINITIONS.decline_bench_press.label).toBe("Decline Bench Press");
    expect(EXERCISE_DEFINITIONS.machine_shoulder_press.label).toBe("Machine Shoulder Press");
    expect(EXERCISE_DEFINITIONS.t_bar_row.label).toBe("T-Bar Row");
    expect(EXERCISE_DEFINITIONS.stationary_bike.label).toBe("Stationary Bike");
    expect(EXERCISE_DEFINITIONS.jump_rope.label).toBe("Jump Rope");
    expect(EXERCISE_DEFINITIONS.push_up.label).toBe("Push-up");
    expect(EXERCISE_DEFINITIONS.incline_dumbbell_bench_press.label).toBe("Incline Dumbbell Bench Press");
    expect(EXERCISE_DEFINITIONS.trap_bar_deadlift.label).toBe("Trap Bar Deadlift");
    expect(EXERCISE_DEFINITIONS.hip_abduction_machine.label).toBe("Hip Abduction Machine");
    expect(EXERCISE_DEFINITIONS.russian_twist.label).toBe("Russian Twist");
  });
});

describe("normalizeExerciseName", () => {
  it("returns canonical names when already valid", () => {
    expect(normalizeExerciseName("back_squat")).toBe("back_squat");
    expect(normalizeExerciseName("Decline Bench Press")).toBe("decline_bench_press");
    expect(normalizeExerciseName("Stationary Bike")).toBe("stationary_bike");
    expect(normalizeExerciseName("Push-up")).toBe("push_up");
    expect(normalizeExerciseName("Russian Twist")).toBe("russian_twist");
  });

  it("normalizes common aliases", () => {
    expect(normalizeExerciseName("RDL")).toBe("romanian_deadlift");
    expect(normalizeExerciseName("db bench")).toBe("dumbbell_bench_press");
    expect(normalizeExerciseName("Lat Pull-Down")).toBe("lat_pulldown");
    expect(normalizeExerciseName("tricep pushdowns")).toBe("triceps_pushdown");
    expect(normalizeExerciseName("machine chest press")).toBe("chest_press_machine");
    expect(normalizeExerciseName("tbar row")).toBe("t_bar_row");
    expect(normalizeExerciseName("Incline DB Bench")).toBe("incline_dumbbell_bench_press");
    expect(normalizeExerciseName("Trap Bar DL")).toBe("trap_bar_deadlift");
    expect(normalizeExerciseName("Skullcrushers")).toBe("skull_crusher");
    expect(normalizeExerciseName("Russian Twists")).toBe("russian_twist");
    expect(normalizeExerciseName("EMOM")).toBe("emom");
    expect(normalizeExerciseName("amrap")).toBe("amrap");
  });

  it("handles punctuation-heavy labels used in mixed parser payloads", () => {
    expect(normalizeExerciseName("Pull-up")).toBe("pull_up");
    expect(normalizeExerciseName("Lat   Pull   Down")).toBe("lat_pulldown");
  });

  it("returns null for unknown names", () => {
    expect(normalizeExerciseName("made up movement xyz")).toBeNull();
  });
});
