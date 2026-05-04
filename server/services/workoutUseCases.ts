import { lintWorkoutStructure, type exercisesPayloadSchema, type InsertWorkoutLog, type insertWorkoutLogSchema, type ParsedExercise, type StructureBlockInput, type UpdateWorkoutLog, type updateWorkoutLogSchema } from "@shared/schema";
import type { z } from "zod";

import { env } from "../env";
import { AppError, ErrorCode } from "../errors";
import { parseExercisesFromText } from "../gemini";
import { storage } from "../storage";
import { createWorkoutAndScheduleCoaching, updateWorkout } from "./workoutService";

type CreateWorkoutPayload = z.infer<typeof insertWorkoutLogSchema> & {
  exercises?: z.infer<typeof exercisesPayloadSchema>;
  structureBlocks?: StructureBlockInput[];
};
type UpdateWorkoutPayload = z.infer<typeof updateWorkoutLogSchema> & {
  exercises?: z.infer<typeof exercisesPayloadSchema>;
  structureBlocks?: StructureBlockInput[];
};

export async function createWorkout(input: {
  userId: string;
  payload: CreateWorkoutPayload;
}) {
  const { exercises, structureBlocks, ...workoutData } = input.payload;
  let structured = exercises as ParsedExercise[] | undefined;
  const hasStructureBlocks = Array.isArray(structureBlocks) && structureBlocks.length > 0;
  if ((!structured || structured.length === 0) && !hasStructureBlocks && env.GEMINI_API_KEY) {
    const textToParse = [workoutData.mainWorkout, workoutData.accessory].filter(Boolean).join("\n").trim();
    if (textToParse) {
      const user = await storage.users.getUser(input.userId);
      structured = await parseExercisesFromText(textToParse, user?.weightUnit || "kg", undefined, input.userId);
      if (structured.length === 0) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Text/voice/photo workout content must produce structured exercise sets.", 400);
      }
    }
  }

  const createLint = lintWorkoutStructure(structureBlocks, structured);
  if (createLint.schemaErrors.length > 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, createLint.schemaErrors[0]?.message ?? "Structured workout has schema errors.", 400);
  }

  return createWorkoutAndScheduleCoaching(workoutData as InsertWorkoutLog, structured, input.userId, structureBlocks);
}

export async function updateWorkoutUseCase(input: {
  userId: string;
  workoutId: string;
  payload: UpdateWorkoutPayload;
}) {
  const { exercises, structureBlocks, ...updateData } = input.payload;
  let structured = exercises as ParsedExercise[] | undefined;
  const hasStructureBlocks = Array.isArray(structureBlocks) && structureBlocks.length > 0;

  if ((!structured || structured.length === 0) && !hasStructureBlocks && env.GEMINI_API_KEY) {
    const existing = await storage.workouts.getWorkoutLog(input.workoutId, input.userId);
    if (!existing) return null;

    const mergedMain = updateData.mainWorkout ?? existing.mainWorkout;
    const mergedAccessory = updateData.accessory ?? existing.accessory;
    const textToParse = [mergedMain, mergedAccessory].filter(Boolean).join("\n").trim();
    if (textToParse) {
      const user = await storage.users.getUser(input.userId);
      structured = await parseExercisesFromText(textToParse, user?.weightUnit || "kg", undefined, input.userId);
      if (structured.length === 0) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Text/voice/photo workout updates must produce structured exercise sets.", 400);
      }
    }
  }


  const updateLint = lintWorkoutStructure(structureBlocks, structured);
  if (updateLint.schemaErrors.length > 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, updateLint.schemaErrors[0]?.message ?? "Structured workout has schema errors.", 400);
  }

  return updateWorkout(input.workoutId, updateData as UpdateWorkoutLog, structured, input.userId, structureBlocks);
}
