import type { TimelineEntry as SharedTimelineEntry } from "@shared/schema";

export type TimelineEntry = Pick<
  SharedTimelineEntry,
  "status" | "date" | "focus" | "mainWorkout" | "notes" | "workoutLogId" | "exerciseSets" | "rpe" | "duration" | "weekNumber"
>;
