import { exercisesPayloadSchema, insertCustomExerciseSchema, insertWorkoutLogSchema, MAX_WORKOUT_TEXT_LEN, structureBlocksPayloadSchema, updateWorkoutLogSchema } from "@shared/schema";
import { z } from "zod";

/**
 * Reject a session max heart rate below its average when both are supplied.
 * Manual HR entry makes a transposed-value typo (e.g. avg 180 / max 150)
 * possible; it is physically impossible and would skew HR analyses. Applied at
 * the route level so it covers both create and update without turning the base
 * insert/update schemas into ZodEffects (which can't be .extend()/.partial()'d).
 */
function enforceHeartRateConsistency(
  value: { avgHeartrate?: number | null; maxHeartrate?: number | null },
  ctx: z.RefinementCtx,
): void {
  if (
    value.avgHeartrate != null &&
    value.maxHeartrate != null &&
    value.maxHeartrate < value.avgHeartrate
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxHeartrate"],
      message: "Max heart rate cannot be below average heart rate",
    });
  }
}

export const createWorkoutRouteSchema = insertWorkoutLogSchema
  .extend({ exercises: exercisesPayloadSchema.optional(), structureBlocks: structureBlocksPayloadSchema })
  .superRefine(enforceHeartRateConsistency);
export const updateWorkoutRouteSchema = updateWorkoutLogSchema
  .extend({ exercises: exercisesPayloadSchema.optional(), structureBlocks: structureBlocksPayloadSchema })
  .superRefine(enforceHeartRateConsistency);
export const assignWorkoutPlanDaySchema = z.object({ planDayId: z.string().min(1).nullable() });
export const reparseWorkoutParamsSchema = z.object({ id: z.string().min(1) });
export const reparseWorkoutRouteSchema = z.object({ prescribedMainWorkout: z.string().max(MAX_WORKOUT_TEXT_LEN).nullable().optional(), prescribedAccessory: z.string().max(MAX_WORKOUT_TEXT_LEN).nullable().optional() }).strict();
export const createCustomExerciseSchema = insertCustomExerciseSchema.omit({ userId: true });
