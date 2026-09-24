/**
 * The coaching knowledge behind the exercise-selection brief: what each goal
 * emphasises, which exercises build which HYROX station, which fill a missing
 * movement pattern, which are close variations of a stalled lift, and what
 * each one needs in equipment, skill, and joint tolerance.
 *
 * A curated SUBSET of the ~210-entry catalogue in shared/schema/exercises.ts:
 * these are the exercises the brief is willing to nominate. The model can
 * still prescribe anything in the catalogue, but a candidate the brief puts in
 * front of it has to be one this file can justify.
 *
 * Every table is keyed and valued by canonical `ExerciseName`, so a typo is a
 * type error rather than a candidate that silently never appears.
 */
import type { HyroxStation } from "@shared/raceConstants";
import type { ExerciseName, MovementPattern } from "@shared/schema/exercises";

// ---------------------------------------------------------------------------
// Goal lenses
// ---------------------------------------------------------------------------

/** How the athlete's goal changes which exercises earn a place. */
export type GoalLens = "hyrox" | "running" | "strength" | "hybrid" | "weight_loss" | "general";

export type ExperienceLevel = "beginner" | "intermediate" | "advanced";

/**
 * What each lens asks of exercise choice, in one line the model can hold every
 * pick against. The point is the ORDER of priorities, which is what a generic
 * plan gets wrong: a runner's strength work exists for durability, a HYROX
 * athlete's exists to make the stations cheaper.
 */
export const LENS_SUMMARIES: Record<GoalLens, string> = {
  hyrox:
    "HYROX / functional racing — the 8 stations at race standard, compromised running (runs straight off a station), grip and carry endurance, lunge and wall-ball leg endurance. Strength work exists to make the stations cheaper, not for its own sake.",
  running:
    "RUNNING — running comes first (easy volume, one threshold and one faster session a week, a long run). Strength is 1-2 short sessions for durability and economy: single-leg strength, posterior chain, calves/soleus and feet, hip stability. No HYROX station work unless the athlete asks for it.",
  strength:
    "STRENGTH — the main lifts come first (squat, hinge, a bench and an overhead press, a heavy pull), progressed by load. Accessories target the main lifts' weak points and keep pushing and pulling balanced. Conditioning stays short and low-impact so it doesn't blunt strength.",
  hybrid:
    "HYBRID (running + strength) — key run sessions and 2-3 strength sessions share the week. Keep heavy lower-body days 48 h away from key runs, and prefer strength exercises that carry over to running: single-leg work, posterior chain, calves.",
  weight_loss:
    "BODY COMPOSITION — sustainable, low-skill full-body strength (squat, hinge, push, pull, lunge, carry) plus steady cardio and short intervals. Favour big muscle groups and movements the athlete can repeat week after week.",
  general:
    "GENERAL FITNESS — every week touches squat, hinge, push, pull, single-leg, carry and trunk, plus aerobic work and one harder conditioning piece.",
};

/**
 * Keyword tests for classifying a free-text goal. Word-bounded so "skiing"
 * can't read as SkiErg-style racing and "10kg" can't read as a 10K.
 */
export const LENS_GOAL_PATTERNS: Readonly<Record<Exclude<GoalLens, "hybrid" | "general">, RegExp>> =
  {
    hyrox:
      /\bhyrox\b|\bfunctional (?:fitness|racing|race)\b|\bfitness rac(?:e|ing)\b|\bdeka\b|\bspartan\b|\bobstacle\b|\bocr\b/i,
    running:
      /\b(?:half[\s-]?)?marathon\b|\bultra\b|\b(?:5|10|15|21|42)\s?k\b|\b\d{1,3}\s?km\b|\brun(?:s|ning|ner)?\b|\bparkrun\b|\btrail\b|\bmiles?\b/i,
    strength:
      /\bstrength\b|\bstronger\b|\bpowerlift\w*|\bweight\s?lift\w*|\b1\s?rm\b|\bsquat\w*|\bdeadlift\w*|\bbench\b|\bmuscle\b|\bhypertroph\w*|\bbodybuild\w*|\blift(?:s|ing)?\b/i,
    weight_loss:
      /\blose (?:weight|fat|\d+)|\bweight[\s-]?loss\b|\bfat[\s-]?loss\b|\bleaner\b|\bbody ?fat\b|\btone up\b/i,
  };

// ---------------------------------------------------------------------------
// Movement-pattern groups
// ---------------------------------------------------------------------------

/** The coarse groups a coach balances a week across. */
export type PatternGroup = "squat" | "hinge" | "push" | "pull" | "single_leg" | "carry" | "trunk";

export const PATTERN_GROUPS: readonly PatternGroup[] = [
  "squat",
  "hinge",
  "push",
  "pull",
  "single_leg",
  "carry",
  "trunk",
];

export const PATTERN_GROUP_LABELS: Record<PatternGroup, string> = {
  squat: "squat",
  hinge: "hinge",
  push: "push",
  pull: "pull",
  single_leg: "single-leg",
  carry: "carry",
  trunk: "trunk",
};

export const PATTERN_GROUP_BY_MOVEMENT: Record<MovementPattern, PatternGroup> = {
  squat: "squat",
  hinge: "hinge",
  horizontal_push: "push",
  vertical_push: "push",
  horizontal_pull: "pull",
  vertical_pull: "pull",
  lunge_split_squat: "single_leg",
  carry: "carry",
  core_flexion: "trunk",
  core_anti_rotation: "trunk",
};

/**
 * Exercises whose movement-pattern tags are incidental to what they train.
 * A 1000 m row is tagged "horizontal pull", but counting it as a pulling set
 * would let an athlete who rows a lot and never does a row-the-exercise read
 * as balanced. The balance maths is about strength patterns, so engines and
 * plyometrics stay out of it.
 */
export const BALANCE_EXCLUDED: ReadonlySet<string> = new Set<ExerciseName>([
  "skierg",
  "ski_erg_intervals",
  "rowing",
  "rowing_intervals",
  "burpees",
  "burpee_broad_jump",
  "mountain_climbers",
  "battle_ropes",
  "box_jumps",
  "bear_crawl",
  "crab_walk",
  "stair_climber",
  "rucking",
]);

// ---------------------------------------------------------------------------
// Candidate pools
// ---------------------------------------------------------------------------

export type NeedPool =
  | "horizontal_pull"
  | "vertical_pull"
  | "hinge"
  | "squat"
  | "single_leg"
  | "horizontal_push"
  | "vertical_push"
  | "carry"
  | "trunk"
  | "calves_feet"
  | "hip_stability"
  | "engine";

/**
 * The exercises the brief nominates for a need, most broadly useful first.
 * Familiar exercises are moved to the front at selection time, so order here
 * is only the tiebreak among exercises the athlete has never logged.
 */
export const NEED_POOLS: Readonly<Record<NeedPool, readonly ExerciseName[]>> = {
  horizontal_pull: [
    "seated_cable_row",
    "single_arm_dumbbell_row",
    "bent_over_row",
    "chest_supported_row",
    "inverted_row",
    "face_pull",
  ],
  vertical_pull: ["pull_up", "chin_up", "lat_pulldown", "assisted_pull_up"],
  hinge: [
    "romanian_deadlift",
    "trap_bar_deadlift",
    "deadlift",
    "hip_thrust",
    "kettlebell_swings",
    "single_leg_rdl",
    "back_extension",
    "nordic_hamstring_curl",
  ],
  squat: ["back_squat", "front_squat", "goblet_squat", "leg_press", "box_squat"],
  single_leg: [
    "bulgarian_split_squat",
    "reverse_lunge",
    "walking_lunges",
    "step_ups",
    "split_squat",
    "single_leg_rdl",
  ],
  horizontal_push: [
    "bench_press",
    "dumbbell_bench_press",
    "push_up",
    "incline_dumbbell_bench_press",
  ],
  vertical_push: ["overhead_press", "seated_dumbbell_press", "landmine_press", "push_press"],
  carry: ["farmers_carry", "suitcase_carry", "front_rack_carry", "sandbag_carry"],
  trunk: [
    "pallof_press",
    "side_plank",
    "dead_bug",
    "suitcase_carry",
    "ab_wheel_rollout",
    "hanging_leg_raise",
  ],
  calves_feet: ["standing_calf_raise", "seated_calf_raise", "tibialis_raise"],
  hip_stability: ["side_plank", "clamshell", "hip_abduction_machine", "single_leg_rdl"],
  engine: ["rowing_intervals", "ski_erg_intervals", "assault_bike", "bike_erg"],
};

/**
 * The station itself first, then the exercises that build it. A station gap is
 * best closed by the station; the builders are for weeks where the full
 * station would be too costly, or to add strength behind it.
 */
export const STATION_BUILDERS: Readonly<Record<HyroxStation, readonly ExerciseName[]>> = {
  skierg: ["skierg", "ski_erg_intervals", "straight_arm_pulldown", "lat_pulldown"],
  sled_push: ["sled_push", "leg_press", "walking_lunges", "front_squat"],
  sled_pull: ["sled_pull", "seated_cable_row", "bent_over_row", "romanian_deadlift"],
  burpee_broad_jump: ["burpee_broad_jump", "burpees", "box_jumps", "push_up"],
  rowing: ["rowing", "rowing_intervals", "romanian_deadlift", "seated_cable_row"],
  farmers_carry: ["farmers_carry", "suitcase_carry", "front_rack_carry"],
  sandbag_lunges: ["sandbag_lunges", "walking_lunges", "bulgarian_split_squat", "step_ups"],
  wall_balls: ["wall_balls", "dumbbell_thruster", "front_squat", "push_press"],
};

/**
 * The strength pattern a station's gap already stands for. A HYROX athlete
 * who hasn't carried in weeks gets one need ("Farmers Carry: …"), not a second
 * "No carry work" line with the same candidates.
 */
export const STATION_PATTERN_GROUP: Readonly<Partial<Record<HyroxStation, PatternGroup>>> = {
  farmers_carry: "carry",
  sandbag_lunges: "single_leg",
  sled_pull: "pull",
};

/**
 * What to program when the athlete's constraints rule a station out ("no sled
 * at my gym"). Each substitute trains the same muscles in the same direction,
 * so the race-day demand is still being prepared for.
 */
export const STATION_SUBSTITUTES: Readonly<Record<HyroxStation, readonly ExerciseName[]>> = {
  skierg: ["straight_arm_pulldown", "rowing_intervals", "assault_bike"],
  sled_push: ["leg_press", "walking_lunges", "box_step_over", "stair_climber"],
  sled_pull: ["seated_cable_row", "bent_over_row", "rowing_intervals"],
  burpee_broad_jump: ["push_up", "step_ups", "goblet_squat"],
  rowing: ["ski_erg_intervals", "assault_bike", "bike_erg"],
  farmers_carry: ["suitcase_carry", "front_rack_carry", "sandbag_carry"],
  sandbag_lunges: ["step_ups", "reverse_lunge", "goblet_squat"],
  wall_balls: ["dumbbell_thruster", "goblet_squat", "push_press"],
};

/**
 * Close variations to rotate to when a lift stalls: same pattern, similar
 * muscles, a different stimulus. Anything not listed falls back to the other
 * members of its movement-pattern pool.
 */
export const LIFT_VARIATIONS: Readonly<Partial<Record<ExerciseName, readonly ExerciseName[]>>> = {
  back_squat: ["front_squat", "box_squat", "belt_squat", "bulgarian_split_squat"],
  front_squat: ["back_squat", "goblet_squat", "zercher_squat"],
  goblet_squat: ["front_squat", "bulgarian_split_squat", "leg_press"],
  leg_press: ["hack_squat", "belt_squat", "bulgarian_split_squat"],
  deadlift: ["trap_bar_deadlift", "romanian_deadlift", "deficit_deadlift", "rack_pull"],
  trap_bar_deadlift: ["deadlift", "romanian_deadlift", "single_leg_rdl"],
  romanian_deadlift: ["single_leg_rdl", "stiff_leg_deadlift", "hip_thrust", "good_morning"],
  hip_thrust: ["glute_bridge", "romanian_deadlift", "cable_pull_through"],
  bench_press: [
    "close_grip_bench_press",
    "incline_bench_press",
    "dumbbell_bench_press",
    "floor_press",
  ],
  incline_bench_press: ["incline_dumbbell_bench_press", "bench_press", "landmine_press"],
  dumbbell_bench_press: ["bench_press", "incline_dumbbell_bench_press", "floor_press"],
  overhead_press: ["push_press", "seated_dumbbell_press", "landmine_press"],
  push_press: ["overhead_press", "dumbbell_thruster", "seated_dumbbell_press"],
  seated_dumbbell_press: ["overhead_press", "arnold_press", "landmine_press"],
  pull_up: ["chin_up", "lat_pulldown", "inverted_row"],
  chin_up: ["pull_up", "lat_pulldown"],
  lat_pulldown: ["pull_up", "chin_up", "straight_arm_pulldown"],
  bent_over_row: ["pendlay_row", "chest_supported_row", "single_arm_dumbbell_row"],
  seated_cable_row: ["single_arm_cable_row", "chest_supported_row", "bent_over_row"],
  single_arm_dumbbell_row: ["chest_supported_row", "seated_cable_row", "bent_over_row"],
  bulgarian_split_squat: ["reverse_lunge", "split_squat", "step_ups"],
  walking_lunges: ["bulgarian_split_squat", "reverse_lunge", "step_ups"],
  lunges: ["bulgarian_split_squat", "reverse_lunge", "walking_lunges"],
  barbell_thruster: ["dumbbell_thruster", "front_squat", "push_press"],
  dumbbell_thruster: ["barbell_thruster", "front_squat", "push_press"],
  kettlebell_swings: ["romanian_deadlift", "hip_thrust", "kettlebell_clean"],
};

/** Ways to restart progress on a stalled lift without changing the exercise. */
export const STALL_METHODS =
  "or keep the lift and change the method: 3-1-1 tempo, paused reps, a rep-range shift (e.g. 5s to 8s), or +1 rep per set before adding load";

// ---------------------------------------------------------------------------
// Primary lifts (plan blueprint)
// ---------------------------------------------------------------------------

/** A slot in a plan's backbone: one primary lift per slot for the whole plan. */
export type PrimarySlot =
  "squat" | "hinge" | "horizontal_push" | "vertical_push" | "pull" | "single_leg" | "calves";

export const PRIMARY_SLOT_LABELS: Record<PrimarySlot, string> = {
  squat: "squat",
  hinge: "hinge",
  horizontal_push: "horizontal push",
  vertical_push: "vertical push",
  pull: "pull",
  single_leg: "single-leg",
  calves: "calves",
};

/** Which backbone slots each goal needs, most important first. */
export const PRIMARY_SLOTS_BY_LENS: Readonly<Record<GoalLens, readonly PrimarySlot[]>> = {
  hyrox: ["squat", "hinge", "vertical_push", "pull", "single_leg"],
  running: ["single_leg", "hinge", "squat", "calves"],
  strength: ["squat", "hinge", "horizontal_push", "vertical_push", "pull"],
  hybrid: ["squat", "hinge", "single_leg", "horizontal_push", "pull"],
  weight_loss: ["squat", "hinge", "horizontal_push", "pull", "single_leg"],
  general: ["squat", "hinge", "horizontal_push", "pull", "single_leg"],
};

/**
 * Lifts that can carry a slot. Broader than the defaults below, so an athlete
 * who already squats on a belt-squat machine keeps it as their primary rather
 * than being moved onto a barbell for the plan's sake. Isolation work (face
 * pulls, flyes) is deliberately absent: it cannot be the backbone of a slot.
 */
export const PRIMARY_ELIGIBLE: Readonly<Record<PrimarySlot, readonly ExerciseName[]>> = {
  squat: [
    "back_squat",
    "front_squat",
    "goblet_squat",
    "box_squat",
    "leg_press",
    "hack_squat",
    "belt_squat",
    "zercher_squat",
  ],
  hinge: [
    "deadlift",
    "romanian_deadlift",
    "trap_bar_deadlift",
    "sumo_deadlift",
    "hip_thrust",
    "stiff_leg_deadlift",
    "kettlebell_swings",
  ],
  horizontal_push: [
    "bench_press",
    "dumbbell_bench_press",
    "incline_bench_press",
    "incline_dumbbell_bench_press",
    "close_grip_bench_press",
    "floor_press",
    "push_up",
  ],
  vertical_push: [
    "overhead_press",
    "push_press",
    "seated_dumbbell_press",
    "landmine_press",
    "arnold_press",
    "kettlebell_press",
  ],
  pull: [
    "pull_up",
    "chin_up",
    "lat_pulldown",
    "bent_over_row",
    "pendlay_row",
    "seated_cable_row",
    "single_arm_dumbbell_row",
    "chest_supported_row",
    "t_bar_row",
  ],
  single_leg: [
    "bulgarian_split_squat",
    "walking_lunges",
    "reverse_lunge",
    "lunges",
    "split_squat",
    "step_ups",
  ],
  calves: ["standing_calf_raise", "seated_calf_raise", "calf_raise"],
};

/**
 * Default primary per slot when the athlete has no history in it, in
 * preference order — the first one that survives the constraint and skill
 * filters wins. `beginner` and the lens-specific lists override `standard`.
 */
export const PRIMARY_DEFAULTS: Readonly<
  Record<
    PrimarySlot,
    {
      readonly standard: readonly ExerciseName[];
      readonly beginner?: readonly ExerciseName[];
    } & Partial<Record<GoalLens, readonly ExerciseName[]>>
  >
> = {
  squat: {
    standard: ["back_squat", "front_squat", "goblet_squat", "leg_press"],
    beginner: ["goblet_squat", "leg_press", "box_squat"],
    hyrox: ["front_squat", "back_squat", "goblet_squat"],
  },
  hinge: {
    standard: ["romanian_deadlift", "trap_bar_deadlift", "hip_thrust"],
    beginner: ["romanian_deadlift", "kettlebell_swings", "hip_thrust"],
    strength: ["deadlift", "trap_bar_deadlift", "romanian_deadlift"],
  },
  horizontal_push: {
    standard: ["bench_press", "dumbbell_bench_press", "push_up"],
    beginner: ["dumbbell_bench_press", "push_up"],
  },
  vertical_push: {
    standard: ["overhead_press", "seated_dumbbell_press", "landmine_press"],
    beginner: ["seated_dumbbell_press", "landmine_press"],
    hyrox: ["push_press", "overhead_press", "seated_dumbbell_press"],
  },
  pull: {
    standard: ["pull_up", "seated_cable_row", "single_arm_dumbbell_row", "lat_pulldown"],
    beginner: ["lat_pulldown", "seated_cable_row", "single_arm_dumbbell_row"],
    hyrox: ["bent_over_row", "seated_cable_row", "pull_up"],
    strength: ["pull_up", "bent_over_row", "lat_pulldown"],
  },
  single_leg: {
    standard: ["bulgarian_split_squat", "reverse_lunge", "walking_lunges"],
    beginner: ["step_ups", "reverse_lunge", "split_squat"],
    hyrox: ["walking_lunges", "bulgarian_split_squat", "reverse_lunge"],
    running: ["bulgarian_split_squat", "step_ups", "single_leg_rdl"],
  },
  calves: {
    standard: ["standing_calf_raise", "seated_calf_raise", "tibialis_raise"],
  },
};

// ---------------------------------------------------------------------------
// Equipment, skill, and joint-stress tags
// ---------------------------------------------------------------------------

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

/** Lifts whose skill demand makes them a poor first choice for a beginner. */
export const HIGH_SKILL_EXERCISES: ReadonlySet<string> = new Set<ExerciseName>([
  "snatch",
  "power_snatch",
  "hang_snatch",
  "clean",
  "power_clean",
  "hang_clean",
  "clean_and_jerk",
  "jerk",
  "split_jerk",
  "overhead_squat",
  "pistol_squat",
  "handstand_push_up",
  "toes_to_bar",
  "rope_climb",
  "ring_dip",
  "nordic_hamstring_curl",
  "deficit_deadlift",
  "zercher_squat",
  "pendlay_row",
  "kettlebell_snatch",
  "turkish_get_up",
  "good_morning",
]);

/** A body region the athlete's constraints mention, and what it rules out. */
export type StressRegion = "lower_limb_impact" | "overhead" | "spinal_load";

export const STRESS_REGION_LABELS: Record<StressRegion, string> = {
  lower_limb_impact: "lower-limb impact (jumps, sprints)",
  overhead: "overhead pressing",
  spinal_load: "heavy unsupported hinging",
};

/**
 * Conservative on purpose. These only stop the BRIEF from nominating an
 * exercise; the athlete's own words still reach the model, which decides what
 * the athlete can actually do. A false match costs one candidate; a miss
 * would have the brief recommending box jumps next to "achilles tendinopathy".
 */
export const STRESS_REGION_PATTERNS: readonly (readonly [RegExp, StressRegion])[] = [
  [
    /\b(?:knees?|acl|mcl|meniscus|patell\w*|achilles|ankles?|shins?|calf|calves|plantar|foot|feet|hips?)\b/i,
    "lower_limb_impact",
  ],
  [/\b(?:shoulders?|rotator cuff|labrum|impingement)\b/i, "overhead"],
  [
    /\b(?:lower back|low back|lumbar|discs?|sciatica|back pain|back injury|bad back|herniat\w*)\b/i,
    "spinal_load",
  ],
];

export const STRESS_REGION_EXERCISES: Readonly<Record<StressRegion, ReadonlySet<string>>> = {
  lower_limb_impact: new Set<ExerciseName>([
    "box_jumps",
    "burpee_broad_jump",
    "burpees",
    "jump_rope",
    "sprints",
    "hill_repeats",
    "shuttle_run",
    "pistol_squat",
    "sissy_squat",
    "jumping_jacks",
    "high_knees",
  ]),
  overhead: new Set<ExerciseName>([
    "overhead_press",
    "push_press",
    "handstand_push_up",
    "pike_push_up",
    "overhead_squat",
    "overhead_carry",
    "snatch",
    "power_snatch",
    "hang_snatch",
    "jerk",
    "split_jerk",
    "clean_and_jerk",
    "wall_balls",
    "barbell_thruster",
    "dumbbell_thruster",
    "kettlebell_thruster",
    "dumbbell_snatch",
    "kettlebell_snatch",
    "arnold_press",
    "seated_dumbbell_press",
    "machine_shoulder_press",
    "kettlebell_press",
    "turkish_get_up",
  ]),
  spinal_load: new Set<ExerciseName>([
    "deadlift",
    "sumo_deadlift",
    "deficit_deadlift",
    "rack_pull",
    "good_morning",
    "stiff_leg_deadlift",
    "bent_over_row",
    "pendlay_row",
    "clean",
    "power_clean",
    "snatch",
    "clean_and_jerk",
    "zercher_squat",
    "overhead_squat",
  ]),
};

const NEGATION = String.raw`(?:no|without|don'?t have|do not have|can'?t (?:use|access)|cannot (?:use|access)|lack(?:ing)?|missing)`;

function negated(noun: string): RegExp {
  // Up to ~24 characters between the negation and the noun covers "no access
  // to a barbell" without reaching across a sentence into unrelated text.
  return new RegExp(String.raw`\b${NEGATION}\b[^.;\n]{0,24}?\b${noun}`, "i");
}

/** "no X" style equipment limits. Word-bounded; see negated() for the reach. */
export const EQUIPMENT_NEGATION_PATTERNS: readonly (readonly [RegExp, Equipment])[] = [
  [negated(String.raw`barbells?\b`), "barbell"],
  [negated(String.raw`(?:dumb ?bells?|dbs?)\b`), "dumbbell"],
  [negated(String.raw`(?:kettle ?bells?|kbs?)\b`), "kettlebell"],
  [negated(String.raw`(?:machines?|cables?|cable stack)\b`), "machine"],
  [negated(String.raw`(?:pull[\s-]?up bars?|chin[\s-]?up bars?|bars? to hang)\b`), "pullup_bar"],
  [negated(String.raw`(?:rowers?|rowing machines?|concept ?2)\b`), "rower"],
  [negated(String.raw`ski[\s-]?ergs?\b`), "skierg"],
  [negated(String.raw`(?:bikes?|assault bikes?|echo bikes?|bike ?ergs?)\b`), "bike"],
  [negated(String.raw`(?:med(?:icine)? balls?|wall balls?)\b`), "med_ball"],
  [negated(String.raw`sandbags?\b`), "sandbag"],
  [negated(String.raw`(?:plyo )?box(?:es)?\b`), "box"],
  [negated(String.raw`sleds?\b`), "sled"],
];

/**
 * Equipment an "only X" / "X only" statement keeps; everything else is out.
 * Scanned across the whole constraints text, so "just dumbbells and a pull-up
 * bar" keeps both. Bodyweight needs no tag — untagged exercises always pass.
 */
export const ONLY_EQUIPMENT_KEYWORDS: readonly (readonly [RegExp, Equipment])[] = [
  [/\bdumb ?bells?\b/i, "dumbbell"],
  [/\bkettle ?bells?\b/i, "kettlebell"],
  [/\bbarbells?\b/i, "barbell"],
  [/\bpull[\s-]?up bars?\b|\bchin[\s-]?up bars?\b/i, "pullup_bar"],
  [/\browers?\b|\browing machines?\b/i, "rower"],
  [/\bski[\s-]?ergs?\b/i, "skierg"],
  [/\bbikes?\b/i, "bike"],
  [/\bsandbags?\b/i, "sandbag"],
  [/\bmed(?:icine)? balls?\b|\bwall balls?\b/i, "med_ball"],
  [/\bboxe?s?\b/i, "box"],
];

export const ONLY_EQUIPMENT_PATTERN =
  /\b(?:only|just)\b[^.;\n]{0,20}?\b(?:dumb ?bells?|kettle ?bells?|barbells?|body ?weight)\b|\b(?:dumb ?bells?|kettle ?bells?|barbells?|body ?weight)(?: and (?:dumb ?bells?|kettle ?bells?|barbells?))?\s+only\b|\bno equipment\b/i;
