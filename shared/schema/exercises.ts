export const EXERCISE_DEFINITIONS = {
  skierg: { label: "SkiErg", category: "functional" as const, fields: ["distance", "time", "weight"] as const, muscleGroups: ["Lats", "Core"] as const },
  sled_push: { label: "Sled Push", category: "functional" as const, fields: ["distance", "time", "weight"] as const, muscleGroups: ["Quads", "Glutes"] as const },
  sled_pull: { label: "Sled Pull", category: "functional" as const, fields: ["distance", "time", "weight"] as const, muscleGroups: ["Back", "Hamstrings"] as const },
  burpee_broad_jump: { label: "Burpee Broad Jump", category: "functional" as const, fields: ["distance", "time", "reps"] as const, muscleGroups: ["Full Body"] as const },
  rowing: { label: "Rowing", category: "functional" as const, fields: ["distance", "time"] as const, muscleGroups: ["Back", "Legs"] as const },
  farmers_carry: { label: "Farmers Carry", category: "functional" as const, fields: ["distance", "time", "weight"] as const, muscleGroups: ["Forearms", "Core"] as const },
  sandbag_lunges: { label: "Sandbag Lunges", category: "functional" as const, fields: ["distance", "time", "weight"] as const, muscleGroups: ["Quads", "Glutes"] as const },
  wall_balls: { label: "Wall Balls", category: "functional" as const, fields: ["reps", "time", "weight"] as const, muscleGroups: ["Quads", "Shoulders"] as const },
  shuttle_run: { label: "Shuttle Run", category: "functional" as const, fields: ["distance", "time", "sets"] as const, muscleGroups: ["Legs", "Cardio"] as const },
  med_ball_slams: { label: "Med Ball Slams", category: "functional" as const, fields: ["sets", "reps", "weight", "time"] as const, muscleGroups: ["Shoulders", "Core"] as const },
  step_ups: { label: "Step Ups", category: "functional" as const, fields: ["sets", "reps", "weight", "time"] as const, muscleGroups: ["Quads", "Glutes"] as const },
  run_1k: { label: "Run 1K", category: "running" as const, fields: ["distance", "time"] as const, muscleGroups: ["Legs", "Cardio"] as const },
  easy_run: { label: "Easy Run", category: "running" as const, fields: ["distance", "time"] as const, muscleGroups: ["Legs", "Cardio"] as const },
  recovery_run: { label: "Recovery Run", category: "running" as const, fields: ["distance", "time"] as const, muscleGroups: ["Legs", "Cardio"] as const },
  tempo_run: { label: "Tempo Run", category: "running" as const, fields: ["distance", "time"] as const, muscleGroups: ["Legs", "Cardio"] as const },
  interval_run: { label: "Intervals", category: "running" as const, fields: ["distance", "time", "sets"] as const, muscleGroups: ["Legs", "Cardio"] as const },
  hill_repeats: { label: "Hill Repeats", category: "running" as const, fields: ["distance", "time", "sets"] as const, muscleGroups: ["Legs", "Cardio"] as const },
  fartlek_run: { label: "Fartlek Run", category: "running" as const, fields: ["distance", "time"] as const, muscleGroups: ["Legs", "Cardio"] as const },
  long_run: { label: "Long Run", category: "running" as const, fields: ["distance", "time"] as const, muscleGroups: ["Legs", "Cardio"] as const },
  treadmill_run: { label: "Treadmill Run", category: "running" as const, fields: ["distance", "time"] as const, muscleGroups: ["Legs", "Cardio"] as const },
  back_squat: { label: "Back Squat", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Quads", "Glutes"] as const },
  front_squat: { label: "Front Squat", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Quads", "Core"] as const },
  deadlift: { label: "Deadlift", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Hamstrings", "Back"] as const },
  romanian_deadlift: { label: "Romanian Deadlift", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Hamstrings", "Glutes"] as const },
  bench_press: { label: "Bench Press", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Chest", "Triceps"] as const },
  incline_bench_press: { label: "Incline Bench Press", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Chest", "Shoulders"] as const },
  decline_bench_press: { label: "Decline Bench Press", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Chest", "Triceps"] as const },
  overhead_press: { label: "Overhead Press", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Shoulders", "Triceps"] as const },
  push_press: { label: "Push Press", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Shoulders", "Triceps"] as const },
  pull_up: { label: "Pull-ups", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Back", "Biceps"] as const },
  lat_pulldown: { label: "Lat Pulldown", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Back", "Biceps"] as const },
  bent_over_row: { label: "Bent Over Row", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Back", "Biceps"] as const },
  single_arm_dumbbell_row: { label: "Single Arm Dumbbell Row", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Back", "Biceps"] as const },
  lunges: { label: "Lunges", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Quads", "Glutes"] as const },
  bulgarian_split_squat: { label: "Bulgarian Split Squat", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Quads", "Glutes"] as const },
  hip_thrust: { label: "Hip Thrust", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Glutes", "Hamstrings"] as const },
  single_leg_rdl: { label: "Single Leg RDL", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Hamstrings", "Glutes"] as const },
  barbell_thruster: { label: "Barbell Thruster", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Quads", "Shoulders"] as const },
  goblet_squat: { label: "Goblet Squat", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Quads", "Core"] as const },
  dumbbell_snatch: { label: "Dumbbell Snatch", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Shoulders", "Core"] as const },
  dumbbell_bench_press: { label: "Dumbbell Bench Press", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Chest", "Triceps"] as const },
  seated_cable_row: { label: "Seated Cable Row", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Back", "Biceps"] as const },
  chest_supported_row: { label: "Chest Supported Row", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Back", "Biceps"] as const },
  leg_press: { label: "Leg Press", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Quads", "Glutes"] as const },
  hack_squat: { label: "Hack Squat", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Quads", "Glutes"] as const },
  leg_extension: { label: "Leg Extension", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Quads"] as const },
  hamstring_curl: { label: "Hamstring Curl", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Hamstrings"] as const },
  calf_raise: { label: "Calf Raise", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Calves"] as const },
  dip: { label: "Dips", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Chest", "Triceps"] as const },
  triceps_pushdown: { label: "Triceps Pushdown", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Triceps"] as const },
  barbell_curl: { label: "Barbell Curl", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Biceps"] as const },
  dumbbell_curl: { label: "Dumbbell Curl", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Biceps"] as const },
  face_pull: { label: "Face Pull", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Rear Delts", "Upper Back"] as const },
  cable_fly: { label: "Cable Fly", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Chest"] as const },
  pec_deck: { label: "Pec Deck", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Chest"] as const },
  lateral_raise: { label: "Lateral Raise", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Shoulders"] as const },
  rear_delt_fly: { label: "Rear Delt Fly", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Rear Delts"] as const },
  seated_dumbbell_press: { label: "Seated Dumbbell Press", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Shoulders", "Triceps"] as const },
  machine_shoulder_press: { label: "Machine Shoulder Press", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Shoulders", "Triceps"] as const },
  t_bar_row: { label: "T-Bar Row", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Back", "Biceps"] as const },
  chest_press_machine: { label: "Chest Press Machine", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Chest", "Triceps"] as const },
  glute_bridge: { label: "Glute Bridge", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Glutes", "Hamstrings"] as const },
  cable_crunch: { label: "Cable Crunch", category: "strength" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Core"] as const },
  plank: { label: "Plank", category: "strength" as const, fields: ["sets", "time"] as const, muscleGroups: ["Core"] as const },
  hanging_leg_raise: { label: "Hanging Leg Raise", category: "strength" as const, fields: ["sets", "reps"] as const, muscleGroups: ["Core", "Hip Flexors"] as const },
  burpees: { label: "Burpees", category: "conditioning" as const, fields: ["sets", "reps", "time"] as const, muscleGroups: ["Full Body"] as const },
  box_jumps: { label: "Box Jumps", category: "conditioning" as const, fields: ["sets", "reps", "time"] as const, muscleGroups: ["Quads", "Calves"] as const },
  assault_bike: { label: "Assault Bike", category: "conditioning" as const, fields: ["distance", "time"] as const, muscleGroups: ["Legs", "Cardio"] as const },
  stationary_bike: { label: "Stationary Bike", category: "conditioning" as const, fields: ["distance", "time"] as const, muscleGroups: ["Legs", "Cardio"] as const },
  kettlebell_swings: { label: "KB Swings", category: "conditioning" as const, fields: ["sets", "reps", "weight"] as const, muscleGroups: ["Glutes", "Hamstrings"] as const },
  battle_ropes: { label: "Battle Ropes", category: "conditioning" as const, fields: ["sets", "time"] as const, muscleGroups: ["Shoulders", "Core"] as const },
  walking_lunges: { label: "Walking Lunges", category: "conditioning" as const, fields: ["distance", "reps", "time", "weight"] as const, muscleGroups: ["Quads", "Glutes"] as const },
  echo_bike: { label: "Echo Bike", category: "conditioning" as const, fields: ["distance", "time"] as const, muscleGroups: ["Legs", "Cardio"] as const },
  ski_erg_intervals: { label: "SkiErg Intervals", category: "conditioning" as const, fields: ["distance", "time", "sets"] as const, muscleGroups: ["Lats", "Core"] as const },
  jump_rope: { label: "Jump Rope", category: "conditioning" as const, fields: ["time", "reps"] as const, muscleGroups: ["Calves", "Cardio"] as const },
  mountain_climbers: { label: "Mountain Climbers", category: "conditioning" as const, fields: ["sets", "reps", "time"] as const, muscleGroups: ["Core", "Cardio"] as const },
  rowing_intervals: { label: "Rowing Intervals", category: "conditioning" as const, fields: ["distance", "time", "sets"] as const, muscleGroups: ["Back", "Cardio"] as const },
  treadmill_intervals: { label: "Treadmill Intervals", category: "conditioning" as const, fields: ["distance", "time", "sets"] as const, muscleGroups: ["Legs", "Cardio"] as const },
  emom: { label: "EMOM", category: "conditioning" as const, fields: ["time", "reps", "sets"] as const, muscleGroups: ["Full Body"] as const },
  amrap: { label: "AMRAP", category: "conditioning" as const, fields: ["time", "reps", "sets"] as const, muscleGroups: ["Full Body"] as const },
  custom: { label: "Custom", category: "conditioning" as const, fields: ["sets", "reps", "weight", "distance", "time"] as const, muscleGroups: [] as const },
} as const;

export type ExerciseName = keyof typeof EXERCISE_DEFINITIONS;
export const exerciseNames = Object.keys(EXERCISE_DEFINITIONS) as ExerciseName[];

export const EXERCISE_NAME_ALIASES: Record<string, ExerciseName> = {
  rdl: "romanian_deadlift",
  romanian_deadlifts: "romanian_deadlift",
  db_bench: "dumbbell_bench_press",
  dumbbell_bench: "dumbbell_bench_press",
  incline_db_bench: "incline_bench_press",
  ohp: "overhead_press",
  strict_press: "overhead_press",
  lat_pulldowns: "lat_pulldown",
  lat_pull_down: "lat_pulldown",
  pullups: "pull_up",
  chinup: "pull_up",
  chin_up: "pull_up",
  chinups: "pull_up",
  seated_row: "seated_cable_row",
  cable_row: "seated_cable_row",
  chest_supported_rows: "chest_supported_row",
  legpress: "leg_press",
  hacksquat: "hack_squat",
  leg_extensions: "leg_extension",
  hamstring_curls: "hamstring_curl",
  calf_raises: "calf_raise",
  dips: "dip",
  tricep_pushdown: "triceps_pushdown",
  tricep_pushdowns: "triceps_pushdown",
  bb_curl: "barbell_curl",
  curls: "dumbbell_curl",
  db_row: "single_arm_dumbbell_row",
  tbar_row: "t_bar_row",
  machine_chest_press: "chest_press_machine",
  shoulder_press_machine: "machine_shoulder_press",
  lat_raise: "lateral_raise",
  rear_delt_raise: "rear_delt_fly",
  ab_crunch: "cable_crunch",
  hanging_leg_raises: "hanging_leg_raise",
  rope_jump: "jump_rope",
  row_intervals: "rowing_intervals",
};

export function normalizeExerciseName(raw: string): ExerciseName | null {
  const lower = raw.trim().toLowerCase();
  let normalized = "";
  let previousWasSeparator = false;

  for (const char of lower) {
    if ((char >= "a" && char <= "z") || (char >= "0" && char <= "9")) {
      normalized += char;
      previousWasSeparator = false;
      continue;
    }

    if (char === "'" || char === "’") continue;

    if (!previousWasSeparator && normalized.length > 0) {
      normalized += "_";
      previousWasSeparator = true;
    }
  }

  if (normalized.endsWith("_")) normalized = normalized.slice(0, -1);
  if (!normalized) return null;
  if (normalized in EXERCISE_DEFINITIONS) return normalized as ExerciseName;
  return EXERCISE_NAME_ALIASES[normalized] ?? null;
}
