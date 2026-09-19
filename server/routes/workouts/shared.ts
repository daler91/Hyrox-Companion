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

/**
 * Device provenance is server-owned.
 *
 * `source`, `stravaActivityId`, `garminActivityId` and `startedAt` are written
 * by the Strava/Garmin sync and by the device-link routes. Accepting them from
 * a client let a manually-logged workout present itself as a device import —
 * enough to satisfy the checks in `linkStandaloneDeviceLog`. Dedupe queries are
 * per-user so this was an integrity problem rather than a cross-tenant one, but
 * there is no legitimate client that sets them.
 */
const DEVICE_PROVENANCE_FIELDS = {
  source: true,
  stravaActivityId: true,
  garminActivityId: true,
  startedAt: true,
} as const;

export const createWorkoutRouteSchema = insertWorkoutLogSchema
  .omit(DEVICE_PROVENANCE_FIELDS)
  .extend({ exercises: exercisesPayloadSchema.optional(), structureBlocks: structureBlocksPayloadSchema })
  .superRefine(enforceHeartRateConsistency);
/**
 * Plan linkage is NOT patchable through the generic workout update.
 *
 * `PATCH /api/v1/workouts/:id` scopes the row it updates by userId, but it
 * never validated the `planDayId` / `planId` *values* in the body — so a
 * caller could point their own workout at another athlete's plan day. Any
 * later set edit then ran the adherence recompute
 * (`recomputeAdherenceIfPlanLinked` → `persistAdherenceSnapshot`), which reads
 * the prescribed sets for that planDayId with no owner check and writes the
 * counts back onto the caller's row — a read oracle for someone else's
 * prescription, plus a cross-tenant FK.
 *
 * Linking has a dedicated, ownership-checked route
 * (`PATCH /api/v1/workouts/:id/plan-day` → `assignWorkoutPlanDay`, which
 * validates via `getPlanDay(planDayId, userId)`), and that is the only path
 * the client uses. Omitting the fields here means a stray value is stripped by
 * Zod rather than persisted.
 */
export const updateWorkoutRouteSchema = updateWorkoutLogSchema
  .omit({ planDayId: true, planId: true, ...DEVICE_PROVENANCE_FIELDS })
  .extend({ exercises: exercisesPayloadSchema.optional(), structureBlocks: structureBlocksPayloadSchema })
  .superRefine(enforceHeartRateConsistency);
export const assignWorkoutPlanDaySchema = z.object({ planDayId: z.string().min(1).nullable() });
export const reparseWorkoutParamsSchema = z.object({ id: z.string().min(1) });
export const reparseWorkoutRouteSchema = z.object({ prescribedMainWorkout: z.string().max(MAX_WORKOUT_TEXT_LEN).nullable().optional(), prescribedAccessory: z.string().max(MAX_WORKOUT_TEXT_LEN).nullable().optional() }).strict();
export const createCustomExerciseSchema = insertCustomExerciseSchema.omit({ userId: true });
