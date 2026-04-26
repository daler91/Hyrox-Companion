import type { ParsedExercise, PlanDay, UpdateWorkoutLog } from "@shared/schema";

export type LogWorkoutVariables = {
  planDayId: string;
  date: string;
  focus: string;
  mainWorkout: string;
  accessory?: string;
  notes?: string;
  rpe?: number;
  exercises?: ParsedExercise[];
};

export type UpdateDayVariables = {
  dayId: string;
  updates: Partial<PlanDay>;
};

export type UpdateStatusVariables = {
  dayId: string;
  status: string;
};

export type UpdateWorkoutVariables = {
  workoutId: string;
  updates: UpdateWorkoutLog & { exercises?: ParsedExercise[] };
};

export type SaveFromDetailUpdates = {
  focus: string;
  mainWorkout: string;
  accessory: string | null;
  notes: string | null;
  rpe?: number | null;
  exercises?: ParsedExercise[];
};
