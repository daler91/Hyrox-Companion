import { planDaySkipReasonEnum, workoutStatusEnum } from "../enums";
import { z } from "../zod";
import { calendarDateSchema } from "./requests";
import { structureBlocksPayloadSchema, structureSetRelinksPayloadSchema } from "./workouts";

// Request schemas for the training-plan routes (server/routes/plans.ts). They
// live here, not beside their routes, so the route validation and the OpenAPI
// document (shared/openapiRoutes/plans.ts) are the same object.

/** `PATCH /api/v1/plans/:id`: rename a plan. */
export const renameTrainingPlanSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255, "Name must be 255 characters or less"),
});
export type RenameTrainingPlanBody = z.infer<typeof renameTrainingPlanSchema>;

/** `PATCH /api/v1/plans/days/:dayId/status`. */
export const patchDayStatusSchema = z.object({
  status: z.enum(workoutStatusEnum).optional(),
  // A real day, not just its shape: "2026-02-30" reached the date column and
  // came back as a 500 (C50, CODEBASE_ANALYSIS_2026-10-03).
  scheduledDate: calendarDateSchema.nullable().optional(),
  // Optional, and only meaningful alongside `status: "skipped"` — any other
  // status clears it in updatePlanDayStatus.
  skipReason: z.enum(planDaySkipReasonEnum).nullable().optional(),
});
export type PatchDayStatusBody = z.infer<typeof patchDayStatusSchema>;

/**
 * `PATCH /api/v1/plans/days/:dayId/structure`.
 *
 * structureBlocks stays undefined when absent (no default), so the handler can
 * tell relinks sent without blocks from a body that clears them (CL15).
 */
export const planDayStructureBodySchema = z.object({
  structureBlocks: structureBlocksPayloadSchema,
  // Rows that follow a renumbered step, saved with the blocks (CL15).
  relinks: structureSetRelinksPayloadSchema,
});
export type PlanDayStructureBody = z.infer<typeof planDayStructureBodySchema>;

/** `POST /api/v1/plans/days/:dayId/reparse`: text to parse in place of the day's stored text. */
export const planDayReparseBodySchema = z
  .object({
    mainWorkout: z.string().nullable().optional(),
    accessory: z.string().nullable().optional(),
  })
  .strict();
export type PlanDayReparseBody = z.infer<typeof planDayReparseBodySchema>;
