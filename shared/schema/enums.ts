export const workoutStatusEnum = ["planned", "completed", "missed", "skipped"] as const;
export type WorkoutStatus = (typeof workoutStatusEnum)[number];

export const exerciseCategoryEnum = ["hyrox_station", "running", "strength", "conditioning"] as const;
export type ExerciseCategory = (typeof exerciseCategoryEnum)[number];
