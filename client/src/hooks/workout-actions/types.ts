import type { ParsedExercise, PlanDay, TimelineEntry, UpdateWorkoutLog } from "@shared/schema";

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
  /**
   * When true, suppresses the post-log `setDetailEntry(...)` side effect
   * that primes the legacy in-dialog stepper. The new sheet-based flow
   * (LogSheet Tier-1) closes its own surface eagerly and would otherwise
   * see the legacy WorkoutDetailDialogV2 pop open right after a one-tap
   * "Log as planned" — defeating the whole point of the quick path.
   */
  skipDetailReopen?: boolean;
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
