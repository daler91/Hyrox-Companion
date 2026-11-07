import { createWorkoutPayloadSchema, updateWorkoutPayloadSchema } from "@shared/schema";
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

// The request bodies live in shared/schema/types/workouts.ts and the OpenAPI
// document registers the same objects, so the route validator and the
// published contract cannot drift apart; these only add the cross-field HR check.
export const createWorkoutRouteSchema = createWorkoutPayloadSchema.superRefine(enforceHeartRateConsistency);
export const updateWorkoutRouteSchema = updateWorkoutPayloadSchema.superRefine(enforceHeartRateConsistency);
// The other workout request schemas (plan-day assignment, reparse, custom
// exercises, bulk delete, combine, device links, MAF tags, migration reviews)
// live in shared/schema/types/workoutsRequests.ts, beside their OpenAPI paths.
