import { type exercisesPayloadSchema, type InsertWorkoutLog, type insertWorkoutLogSchema, lintWorkoutStructure, type ParsedExercise, type StructureBlockInput, type UpdateWorkoutLog, type updateWorkoutLogSchema } from "@shared/schema";
import type { z } from "zod";

import { env } from "../env";
import { AppError, ErrorCode } from "../errors";
import { parseExercisesFromText } from "../gemini";
import { logger } from "../logger";
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
  const hasStructureBlocks = Array.isArray(structureBlocks);
  if ((!structured || structured.length === 0) && !hasStructureBlocks && env.GEMINI_API_KEY) {
    logger.warn({ context: "workout-structure", event: "legacy_only_parse_fallback_create", userId: input.userId }, "Missing structure-editor payload on create; using legacy parse fallback.");
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
  const hasStructureBlocks = Array.isArray(structureBlocks);

  if ((!structured || structured.length === 0) && !hasStructureBlocks && env.GEMINI_API_KEY) {
    logger.warn({ context: "workout-structure", event: "legacy_only_parse_fallback_update", userId: input.userId, workoutId: input.workoutId }, "Missing structure-editor payload on update; using legacy parse fallback.");
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
