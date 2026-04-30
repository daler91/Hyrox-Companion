import type { ParsedExercise, TimelineEntry } from "@shared/schema";

export type LogWorkoutVariables = {
  planDayId: string;
  date: string;
  focus: string;
  mainWorkout: string;
  accessory?: string;
  notes?: string;
  rpe?: number;
  exercises?: ParsedExercise[];
  sourceEntry?: TimelineEntry;
};

export type UpdateStatusVariables = {
  dayId: string;
  status: string;
};
