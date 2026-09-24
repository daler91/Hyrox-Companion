/**
 * What an exercise is loaded with, and the smallest jump that load comes in.
 *
 * Shared because two surfaces prescribe weights: the workout engine writes
 * them into plans (server/services/workoutEngine) and the workout detail's
 * "Next" chip suggests them while logging (shared/progression.ts). With one
 * table the chip can no longer suggest 25.25 kg on a dumbbell the plan steps
 * in 2 kg, and the equipment tags the exercise brief filters on
 * (server/services/ai/exerciseProfile.ts) are the same ones.
 *
 * Kept free of the schema barrel so it ships to the browser.
 */
import type { ExerciseName } from "./schema/exercises";
import type { WeightUnit } from "./unitConversion";

export type Equipment =
  | "barbell"
  | "dumbbell"
  | "kettlebell"
  | "machine"
  | "pullup_bar"
  | "sled"
  | "rower"
  | "skierg"
  | "bike"
  | "med_ball"
  | "sandbag"
  | "box";

/**
 * Equipment an exercise needs — ANY ONE of the listed items is enough (a
 * goblet squat works with a dumbbell or a kettlebell). An exercise absent from
 * this table needs nothing the constraint filter can rule out: bodyweight, or
 * a load the athlete can improvise (walking lunges holding anything).
 */
export const EXERCISE_EQUIPMENT: Readonly<Partial<Record<ExerciseName, readonly Equipment[]>>> = {
  back_squat: ["barbell"],
  front_squat: ["barbell"],
  box_squat: ["barbell"],
  zercher_squat: ["barbell"],
  deadlift: ["barbell"],
  sumo_deadlift: ["barbell"],
  deficit_deadlift: ["barbell"],
  rack_pull: ["barbell"],
  good_morning: ["barbell"],
  trap_bar_deadlift: ["barbell"],
  romanian_deadlift: ["barbell", "dumbbell", "kettlebell"],
  stiff_leg_deadlift: ["barbell", "dumbbell"],
  hip_thrust: ["barbell", "dumbbell", "machine"],
  bench_press: ["barbell"],
  close_grip_bench_press: ["barbell"],
  incline_bench_press: ["barbell"],
  floor_press: ["barbell", "dumbbell"],
  overhead_press: ["barbell"],
  push_press: ["barbell", "dumbbell"],
  landmine_press: ["barbell"],
  bent_over_row: ["barbell", "dumbbell"],
  pendlay_row: ["barbell"],
  t_bar_row: ["barbell", "machine"],
  barbell_thruster: ["barbell"],
  dumbbell_bench_press: ["dumbbell"],
  incline_dumbbell_bench_press: ["dumbbell"],
  seated_dumbbell_press: ["dumbbell"],
  arnold_press: ["dumbbell"],
  single_arm_dumbbell_row: ["dumbbell", "kettlebell"],
  goblet_squat: ["dumbbell", "kettlebell"],
  dumbbell_thruster: ["dumbbell"],
  kettlebell_thruster: ["kettlebell"],
  kettlebell_swings: ["kettlebell"],
  kettlebell_clean: ["kettlebell"],
  kettlebell_press: ["kettlebell"],
  single_leg_rdl: ["dumbbell", "kettlebell"],
  farmers_carry: ["dumbbell", "kettlebell"],
  suitcase_carry: ["dumbbell", "kettlebell"],
  front_rack_carry: ["kettlebell", "dumbbell"],
  chest_supported_row: ["machine", "dumbbell"],
  leg_press: ["machine"],
  hack_squat: ["machine"],
  belt_squat: ["machine"],
  lat_pulldown: ["machine"],
  straight_arm_pulldown: ["machine"],
  seated_cable_row: ["machine"],
  single_arm_cable_row: ["machine"],
  face_pull: ["machine"],
  pallof_press: ["machine"],
  cable_pull_through: ["machine"],
  hip_abduction_machine: ["machine"],
  seated_calf_raise: ["machine", "dumbbell"],
  back_extension: ["machine"],
  stair_climber: ["machine"],
  elliptical: ["machine"],
  pull_up: ["pullup_bar"],
  chin_up: ["pullup_bar"],
  assisted_pull_up: ["pullup_bar", "machine"],
  hanging_leg_raise: ["pullup_bar"],
  inverted_row: ["pullup_bar", "barbell"],
  sled_push: ["sled"],
  sled_pull: ["sled"],
  rowing: ["rower"],
  rowing_intervals: ["rower"],
  skierg: ["skierg"],
  ski_erg_intervals: ["skierg"],
  assault_bike: ["bike"],
  echo_bike: ["bike"],
  bike_erg: ["bike"],
  wall_balls: ["med_ball"],
  sandbag_lunges: ["sandbag"],
  sandbag_carry: ["sandbag"],
  box_jumps: ["box"],
  box_step_over: ["box"],
};

export type Implement = "barbell" | "dumbbell" | "kettlebell" | "machine" | "bodyweight";

/**
 * Where the equipment table can't say how an exercise is loaded: bodyweight
 * lifts (a logged weight there is added load, which Epley cannot read), and
 * lunge-family work the table leaves open because it can be done holding
 * anything — logged with dumbbells far more often than not.
 */
const IMPLEMENT_OVERRIDES: Readonly<Partial<Record<ExerciseName, Implement>>> = {
  pull_up: "bodyweight",
  chin_up: "bodyweight",
  push_up: "bodyweight",
  dip: "bodyweight",
  ring_dip: "bodyweight",
  inverted_row: "bodyweight",
  pistol_squat: "bodyweight",
  tibialis_raise: "bodyweight",
  walking_lunges: "dumbbell",
  reverse_lunge: "dumbbell",
  lunges: "dumbbell",
  split_squat: "dumbbell",
  bulgarian_split_squat: "dumbbell",
  step_ups: "dumbbell",
  calf_raise: "dumbbell",
  standing_calf_raise: "machine",
};

interface ImplementSteps {
  readonly kg: number;
  readonly lbs: number;
}

const BARBELL_STEPS: ImplementSteps = { kg: 2.5, lbs: 5 };

/** The smallest jump each implement allows, per unit. Bodyweight work loads like a barbell. */
const INCREMENTS: ReadonlyMap<Implement, ImplementSteps> = new Map([
  ["barbell", BARBELL_STEPS],
  ["dumbbell", { kg: 2, lbs: 5 }],
  ["kettlebell", { kg: 4, lbs: 5 }],
  ["machine", { kg: 5, lbs: 10 }],
]);

const LOADED_IMPLEMENTS: readonly Exclude<Implement, "bodyweight">[] = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "machine",
];

export function implementFor(exercise: string): Implement {
  const override = IMPLEMENT_OVERRIDES[exercise as ExerciseName];
  if (override) return override;
  const equipment = EXERCISE_EQUIPMENT[exercise as ExerciseName] ?? [];
  return LOADED_IMPLEMENTS.find((implement) => equipment.includes(implement)) ?? "barbell";
}

export function loadIncrement(exercise: string, unit: WeightUnit): number {
  const steps = INCREMENTS.get(implementFor(exercise)) ?? BARBELL_STEPS;
  return unit === "kg" ? steps.kg : steps.lbs;
}
