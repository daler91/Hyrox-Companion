import { describe, expect, it } from "vitest";

import {
  EXERCISE_DEFINITIONS,
  getExerciseMovementPatterns,
  MOVEMENT_PATTERNS,
  normalizeExerciseName,
} from "./exercises";

const requestedExpandedExerciseKeys = [
  "air_squat",
  "overhead_squat",
  "zercher_squat",
  "pistol_squat",
  "split_squat",
  "cossack_squat",
  "belt_squat",
  "stiff_leg_deadlift",
  "rack_pull",
  "deficit_deadlift",
  "floor_press",
  "smith_machine_bench_press",
  "dumbbell_pullover",
  "landmine_press",
  "upright_row",
  "pendlay_row",
  "machine_row",
  "landmine_row",
  "assisted_dip",
  "ring_dip",
  "handstand_push_up",
  "pike_push_up",
  "nordic_hamstring_curl",
  "glute_ham_raise",
  "cable_pull_through",
  "seated_calf_raise",
  "standing_calf_raise",
  "tibialis_raise",
  "clean",
  "power_clean",
  "hang_clean",
  "clean_and_jerk",
  "jerk",
  "split_jerk",
  "snatch",
  "power_snatch",
  "hang_snatch",
  "turkish_get_up",
  "kettlebell_clean",
  "kettlebell_snatch",
  "kettlebell_press",
  "devil_press",
  "side_plank",
  "ab_wheel_rollout",
  "pallof_press",
  "bird_dog",
  "reverse_crunch",
  "bicycle_crunch",
  "lying_leg_raise",
  "toes_to_bar",
  "v_up",
  "hollow_hold",
  "flutter_kicks",
  "walking",
  "incline_walk",
  "hiking",
  "rucking",
  "cycling",
  "bike_erg",
  "elliptical",
  "stair_climber",
  "swimming",
  "sprints",
  "bear_crawl",
  "crab_walk",
  "jumping_jacks",
  "high_knees",
  "butt_kicks",
  "suitcase_carry",
  "overhead_carry",
  "front_rack_carry",
  "yoke_carry",
  "sandbag_carry",
  "sandbag_clean",
  "sandbag_to_shoulder",
  "tire_flip",
  "rope_climb",
  "box_step_over",
  "dumbbell_thruster",
  "kettlebell_thruster",
  "concentration_curl",
  "incline_dumbbell_curl",
  "reverse_curl",
  "wrist_curl",
  "reverse_wrist_curl",
  "bench_dip",
  "triceps_kickback",
  "rope_triceps_pushdown",
  "machine_lateral_raise",
  "reverse_pec_deck",
  "cable_rear_delt_fly",
  "band_pull_apart",
  "single_arm_cable_row",
  "high_row_machine",
  "pullover_machine",
  "sissy_squat",
  "pendulum_squat",
  "donkey_kick",
  "frog_pump",
  "clamshell",
] as const;

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

  it("includes the requested expanded exercise set", () => {
    for (const exerciseKey of requestedExpandedExerciseKeys) {
      expect(EXERCISE_DEFINITIONS[exerciseKey]).toBeDefined();
    }

    expect(EXERCISE_DEFINITIONS.air_squat.label).toBe("Air Squat");
    expect(EXERCISE_DEFINITIONS.clean_and_jerk.label).toBe("Clean and Jerk");
    expect(EXERCISE_DEFINITIONS.bike_erg.label).toBe("BikeErg");
    expect(EXERCISE_DEFINITIONS.suitcase_carry.label).toBe("Suitcase Carry");
    expect(EXERCISE_DEFINITIONS.rope_climb.label).toBe("Rope Climb");
    expect(EXERCISE_DEFINITIONS.ab_wheel_rollout.label).toBe("Ab Wheel Rollout");
    expect(EXERCISE_DEFINITIONS.bench_dip.label).toBe("Bench Dip");
    expect(EXERCISE_DEFINITIONS.clamshell.label).toBe("Clamshell");
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
    expect(normalizeExerciseName("BikeErg")).toBe("bike_erg");
    expect(normalizeExerciseName("HSPU")).toBe("handstand_push_up");
    expect(normalizeExerciseName("TGU")).toBe("turkish_get_up");
    expect(normalizeExerciseName("Clean & Jerk")).toBe("clean_and_jerk");
    expect(normalizeExerciseName("Toes-to-Bar")).toBe("toes_to_bar");
    expect(normalizeExerciseName("KB Thruster")).toBe("kettlebell_thruster");
    expect(normalizeExerciseName("Ab Rollouts")).toBe("ab_wheel_rollout");
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

describe("movement pattern metadata", () => {
  it("keeps the requested movement patterns in dashboard order", () => {
    expect(MOVEMENT_PATTERNS.map(({ pattern, label }) => [pattern, label])).toEqual([
      ["squat", "Squat pattern"],
      ["hinge", "Hinge pattern"],
      ["horizontal_push", "Horizontal push"],
      ["vertical_push", "Vertical push"],
      ["horizontal_pull", "Horizontal pull"],
      ["vertical_pull", "Vertical pull"],
      ["lunge_split_squat", "Lunge / split squat"],
      ["carry", "Carry"],
      ["core_flexion", "Core flexion"],
      ["core_anti_rotation", "Core anti-rotation"],
    ]);
  });

  it("maps representative catalog exercises to movement patterns", () => {
    expect(getExerciseMovementPatterns("back_squat")).toContain("squat");
    expect(getExerciseMovementPatterns("deadlift")).toContain("hinge");
    expect(getExerciseMovementPatterns("romanian_deadlift")).toContain("hinge");
    expect(getExerciseMovementPatterns("bench_press")).toContain("horizontal_push");
    expect(getExerciseMovementPatterns("push_up")).toContain("horizontal_push");
    expect(getExerciseMovementPatterns("overhead_press")).toContain("vertical_push");
    expect(getExerciseMovementPatterns("bent_over_row")).toContain("horizontal_pull");
    expect(getExerciseMovementPatterns("pull_up")).toContain("vertical_pull");
    expect(getExerciseMovementPatterns("lat_pulldown")).toContain("vertical_pull");
    expect(getExerciseMovementPatterns("lunges")).toContain("lunge_split_squat");
    expect(getExerciseMovementPatterns("bulgarian_split_squat")).toContain("lunge_split_squat");
    expect(getExerciseMovementPatterns("farmers_carry")).toContain("carry");
    expect(getExerciseMovementPatterns("crunch")).toContain("core_flexion");
    expect(getExerciseMovementPatterns("sit_up")).toContain("core_flexion");
    expect(getExerciseMovementPatterns("pallof_press")).toContain("core_anti_rotation");
    expect(getExerciseMovementPatterns("side_plank")).toContain("core_anti_rotation");
  });

  it("uses catalog normalization before resolving movement patterns", () => {
    expect(getExerciseMovementPatterns("Back Squat")).toContain("squat");
    expect(getExerciseMovementPatterns("RDL")).toContain("hinge");
    expect(getExerciseMovementPatterns("Lat Pull-Down")).toContain("vertical_pull");
  });

  it("does not map custom or unknown exercises", () => {
    expect(getExerciseMovementPatterns("custom")).toEqual([]);
    expect(getExerciseMovementPatterns("made_up_movement")).toEqual([]);
  });
});
