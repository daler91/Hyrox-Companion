import type { ExerciseSet, WorkoutLog } from "@shared/schema";

import type { db } from "../../db";

export type WorkoutTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type SetOwner = { workoutLogId: string } | { planDayId: string };

export interface ReplaceStructureOptions {
  readonly deriveExerciseSets?: boolean;
}

export type CreateWorkoutResult = WorkoutLog & { exerciseSets?: ExerciseSet[] };
export type UpdateWorkoutResult = WorkoutLog & { exerciseSets?: ExerciseSet[] };
