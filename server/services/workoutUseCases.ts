import { type exercisesPayloadSchema, type insertWorkoutLogSchema, lintWorkoutStructure, type ParsedExercise, type StructureBlockInput, type updateWorkoutLogSchema } from "@shared/schema";
import type { z } from "zod";

import { isTextAiProviderConfigured } from "../ai/providers";
import { AppError, ErrorCode } from "../errors";
import { parseExercisesFromText } from "../gemini";
import { logger } from "../logger";
import { storage } from "../storage";
import { findPersonalRecordAchievements } from "./personalRecordAchievements";
import { assignWorkoutPlanDay, createWorkoutAndScheduleCoaching, updateWorkout } from "./workoutService";

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
  // Skip the legacy AI reparse when the workout is backed by a plan day:
  // createWorkoutInTx.copyPrescribedSetsIntoLog will seed the new log from the
  // plan day's already-persisted (possibly edited) exercise rows. Re-parsing
  // here would supply fresh rows that win over the copy path and overwrite
  // the athlete's pre-log edits.
  const canCopyFromPlanDay = !!workoutData.planDayId;
  if ((!structured || structured.length === 0) && !hasStructureBlocks && !canCopyFromPlanDay && isTextAiProviderConfigured()) {
    logger.warn({ context: "workout-structure", event: "legacy_only_parse_fallback_create", userId: input.userId }, "Missing structure-editor payload on create; using legacy parse fallback.");
    const textToParse = [workoutData.mainWorkout, workoutData.accessory].filter(Boolean).join("\n").trim();
    if (textToParse) {
      const user = await storage.users.getUser(input.userId);
      structured = await parseExercisesFromText(
        textToParse,
        { weightUnit: user?.weightUnit || "kg", distanceUnit: user?.distanceUnit || "km" },
        undefined,
        input.userId,
      );
      if (structured.length === 0) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Text/voice/photo workout content must produce structured exercise sets.", 400);
      }
    }
  }

  const createLint = lintWorkoutStructure(structureBlocks, structured);
  if (createLint.schemaErrors.length > 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, createLint.schemaErrors[0]?.message ?? "Structured workout has schema errors.", 400);
  }

  const createdWorkout = await createWorkoutAndScheduleCoaching(workoutData, structured, input.userId, structureBlocks);
  if (!createdWorkout.exerciseSets || createdWorkout.exerciseSets.length === 0) return createdWorkout;

  let newPersonalRecords: ReturnType<typeof findPersonalRecordAchievements>;
  try {
    const allSets = await storage.analytics.getAllExerciseSetsWithDates(input.userId);
    const priorSets = allSets.filter((set) => set.workoutLogId !== createdWorkout.id);
    newPersonalRecords = findPersonalRecordAchievements(priorSets, createdWorkout);
  } catch (err) {
    logger.warn(
      { err, userId: input.userId, workoutLogId: createdWorkout.id },
      "Failed to compute personal record achievements after workout create.",
    );
    return createdWorkout;
  }

  return newPersonalRecords.length > 0
    ? { ...createdWorkout, newPersonalRecords }
    : createdWorkout;
}

export async function updateWorkoutUseCase(input: {
  userId: string;
  workoutId: string;
  payload: UpdateWorkoutPayload;
}) {
  const { exercises, structureBlocks, ...updateData } = input.payload;
  const structured = exercises as ParsedExercise[] | undefined;
  // PATCHes that omit `exercises` / `structureBlocks` preserve existing rows.
  // The old legacy-parse fallback re-parsed mainWorkout via AI and replaced
  // them, silently destroying edits whenever a text-only field was patched.

  const updateLint = lintWorkoutStructure(structureBlocks, structured);
  if (updateLint.schemaErrors.length > 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, updateLint.schemaErrors[0]?.message ?? "Structured workout has schema errors.", 400);
  }

  return updateWorkout(input.workoutId, updateData, structured, input.userId, structureBlocks);
}

export async function assignWorkoutPlanDayUseCase(input: {
  userId: string;
  workoutId: string;
  planDayId: string | null;
}) {
  return assignWorkoutPlanDay(input.workoutId, input.planDayId, input.userId);
}
