export const workoutStatusEnum = ["planned", "completed", "missed", "skipped"] as const;
export type WorkoutStatus = (typeof workoutStatusEnum)[number];

export const exerciseCategoryEnum = ["functional", "running", "strength", "conditioning"] as const;
export type ExerciseCategory = (typeof exerciseCategoryEnum)[number];
