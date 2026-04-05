import type { z } from "zod";
import type { insertWorkoutLogSchema, updateWorkoutLogSchema, exercisesPayloadSchema, InsertWorkoutLog, UpdateWorkoutLog, ParsedExercise } from "@shared/schema";
import { createWorkoutAndScheduleCoaching, updateWorkout } from "./workoutService";

// Route-level payloads carry the core table columns plus an optional parsed
// `exercises` array. The use-case layer exists to keep route handlers thin
// (CODEBASE_AUDIT.md §1): transport concerns stay in routes, DB/orchestration
// stays in workoutService, and these wrappers are the only place where the
// payload shape is split into its service-level arguments.
type CreateWorkoutPayload = z.infer<typeof insertWorkoutLogSchema> & {
  exercises?: z.infer<typeof exercisesPayloadSchema>;
};
type UpdateWorkoutPayload = z.infer<typeof updateWorkoutLogSchema> & {
  exercises?: z.infer<typeof exercisesPayloadSchema>;
};

export async function createWorkout(input: {
  userId: string;
  payload: CreateWorkoutPayload;
}) {
  const { exercises, ...workoutData } = input.payload;
  return createWorkoutAndScheduleCoaching(
    workoutData as InsertWorkoutLog,
    exercises as ParsedExercise[] | undefined,
    input.userId,
  );
}

export async function updateWorkoutUseCase(input: {
  userId: string;
  workoutId: string;
  payload: UpdateWorkoutPayload;
}) {
  const { exercises, ...updateData } = input.payload;
  return updateWorkout(
    input.workoutId,
    updateData as UpdateWorkoutLog,
    exercises as ParsedExercise[] | undefined,
    input.userId,
  );
}
