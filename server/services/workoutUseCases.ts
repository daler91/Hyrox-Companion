import type { exercisesPayloadSchema, InsertWorkoutLog, insertWorkoutLogSchema, ParsedExercise,UpdateWorkoutLog, updateWorkoutLogSchema } from "@shared/schema";
import type { z } from "zod";

import { AppError, ErrorCode } from "../errors";
import { parseExercisesFromText } from "../gemini";
import { storage } from "../storage";
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
  let structured = exercises as ParsedExercise[] | undefined;
  if (!structured || structured.length === 0) {
    const textToParse = [workoutData.mainWorkout, workoutData.accessory].filter(Boolean).join("\n").trim();
    if (textToParse) {
      const user = await storage.users.getUser(input.userId);
      structured = await parseExercisesFromText(textToParse, user?.weightUnit || "kg", undefined, input.userId);
      if (structured.length === 0) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Text/voice/photo workout content must produce structured exercise sets.", 400);
      }
    }
  }
  return createWorkoutAndScheduleCoaching(
    workoutData as InsertWorkoutLog,
    structured,
    input.userId,
  );
}

export async function updateWorkoutUseCase(input: {
  userId: string;
  workoutId: string;
  payload: UpdateWorkoutPayload;
}) {
  const { exercises, ...updateData } = input.payload;
  let structured = exercises as ParsedExercise[] | undefined;
  if (!structured || structured.length === 0) {
    const textToParse = [updateData.mainWorkout, updateData.accessory].filter(Boolean).join("\n").trim();
    if (textToParse) {
      const user = await storage.users.getUser(input.userId);
      structured = await parseExercisesFromText(textToParse, user?.weightUnit || "kg", undefined, input.userId);
      if (structured.length === 0) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Text/voice/photo workout updates must produce structured exercise sets.", 400);
      }
    }
  }
  return updateWorkout(
    input.workoutId,
    updateData as UpdateWorkoutLog,
    structured,
    input.userId,
  );
}
