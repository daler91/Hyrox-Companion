/**
 * Valid state transitions for plan_days.status and workout_logs status
 * (S15). Any write path that mutates status MUST land inside one of these
 * arrows.
 *
 *   planned    → completed  (user logs a workout for that day)
 *   planned    → skipped    (user explicitly skips)
 *   planned    → missed     (cron marks past planned days as missed)
 *   missed     → completed  (user back-fills a late log)
 *   skipped    → completed  (user un-skips and logs)
 *   completed  → planned    (FORBIDDEN — deletes should drive status from
 *                           the underlying workout_logs count; see S6)
 *   missed     → planned    (FORBIDDEN — once missed, always missed unless
 *                           the user completes)
 *   skipped    → planned    (FORBIDDEN — explicit skips stay explicit)
 */
export const workoutStatusEnum = ["planned", "completed", "missed", "skipped"] as const;
export type WorkoutStatus = (typeof workoutStatusEnum)[number];

export const exerciseCategoryEnum = ["functional", "running", "strength", "conditioning"] as const;
export type ExerciseCategory = (typeof exerciseCategoryEnum)[number];
