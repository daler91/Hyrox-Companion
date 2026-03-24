export const EXERCISE_DEFINITIONS = {
  skierg: {
    label: "SkiErg",
    category: "hyrox_station" as const,
    fields: ["distance", "time", "weight"] as const,
  },
  sled_push: {
    label: "Sled Push",
    category: "hyrox_station" as const,
    fields: ["distance", "time", "weight"] as const,
  },
  sled_pull: {
    label: "Sled Pull",
    category: "hyrox_station" as const,
    fields: ["distance", "time", "weight"] as const,
  },
  burpee_broad_jump: {
    label: "Burpee Broad Jump",
    category: "hyrox_station" as const,
    fields: ["distance", "time", "reps"] as const,
  },
  rowing: {
    label: "Rowing",
    category: "hyrox_station" as const,
    fields: ["distance", "time"] as const,
  },
  farmers_carry: {
    label: "Farmers Carry",
    category: "hyrox_station" as const,
    fields: ["distance", "time", "weight"] as const,
  },
  sandbag_lunges: {
    label: "Sandbag Lunges",
    category: "hyrox_station" as const,
    fields: ["distance", "time", "weight"] as const,
  },
  wall_balls: {
    label: "Wall Balls",
    category: "hyrox_station" as const,
    fields: ["reps", "time", "weight"] as const,
  },
  easy_run: {
    label: "Easy Run",
    category: "running" as const,
    fields: ["distance", "time"] as const,
  },
  tempo_run: {
    label: "Tempo Run",
    category: "running" as const,
    fields: ["distance", "time"] as const,
  },
  interval_run: {
    label: "Intervals",
    category: "running" as const,
    fields: ["distance", "time", "sets"] as const,
  },
  long_run: {
    label: "Long Run",
    category: "running" as const,
    fields: ["distance", "time"] as const,
  },
  back_squat: {
    label: "Back Squat",
    category: "strength" as const,
    fields: ["sets", "reps", "weight"] as const,
  },
  front_squat: {
    label: "Front Squat",
    category: "strength" as const,
    fields: ["sets", "reps", "weight"] as const,
  },
  deadlift: {
    label: "Deadlift",
    category: "strength" as const,
    fields: ["sets", "reps", "weight"] as const,
  },
  romanian_deadlift: {
    label: "Romanian Deadlift",
    category: "strength" as const,
    fields: ["sets", "reps", "weight"] as const,
  },
  bench_press: {
    label: "Bench Press",
    category: "strength" as const,
    fields: ["sets", "reps", "weight"] as const,
  },
  overhead_press: {
    label: "Overhead Press",
    category: "strength" as const,
    fields: ["sets", "reps", "weight"] as const,
  },
  pull_up: {
    label: "Pull-ups",
    category: "strength" as const,
    fields: ["sets", "reps", "weight"] as const,
  },
  bent_over_row: {
    label: "Bent Over Row",
    category: "strength" as const,
    fields: ["sets", "reps", "weight"] as const,
  },
  lunges: {
    label: "Lunges",
    category: "strength" as const,
    fields: ["sets", "reps", "weight"] as const,
  },
  hip_thrust: {
    label: "Hip Thrust",
    category: "strength" as const,
    fields: ["sets", "reps", "weight"] as const,
  },
  burpees: {
    label: "Burpees",
    category: "conditioning" as const,
    fields: ["sets", "reps", "time"] as const,
  },
  box_jumps: {
    label: "Box Jumps",
    category: "conditioning" as const,
    fields: ["sets", "reps", "time"] as const,
  },
  assault_bike: {
    label: "Assault Bike",
    category: "conditioning" as const,
    fields: ["distance", "time"] as const,
  },
  kettlebell_swings: {
    label: "KB Swings",
    category: "conditioning" as const,
    fields: ["sets", "reps", "weight"] as const,
  },
  battle_ropes: {
    label: "Battle Ropes",
    category: "conditioning" as const,
    fields: ["sets", "time"] as const,
  },
  custom: {
    label: "Custom",
    category: "conditioning" as const,
    fields: ["sets", "reps", "weight", "distance", "time"] as const,
  },
} as const;

export type ExerciseName = keyof typeof EXERCISE_DEFINITIONS;
export const exerciseNames = Object.keys(EXERCISE_DEFINITIONS) as ExerciseName[];
