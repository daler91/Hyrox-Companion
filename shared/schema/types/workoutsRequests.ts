import { z } from "../zod";
import {
  insertCustomExerciseSchema,
  insertWorkoutLogRouteSchema,
  MAX_WORKOUT_TEXT_LEN,
  structureBlockScoreSchema,
} from "./workouts";

// Request schemas for the workout endpoints beyond create/update (sets aside,
// which live in ./workouts): exercises, device links, MAF tags, AI reparse and
// assisted migration. They live here, not beside their routes, so the route
// validation and the OpenAPI document (shared/openapiRoutes/workouts.ts) are
// the same object and cannot drift apart.

/** POST /api/v1/custom-exercises. `category` defaults to "conditioning" server-side. */
export const createCustomExerciseSchema = insertCustomExerciseSchema.omit({ userId: true });
export type CreateCustomExerciseBody = z.infer<typeof createCustomExerciseSchema>;

/** PATCH /api/v1/workouts/:id/plan-day. A null planDayId unlinks the workout from its plan day. */
export const assignWorkoutPlanDaySchema = z.object({ planDayId: z.string().min(1).nullable() });
export type AssignWorkoutPlanDayBody = z.infer<typeof assignWorkoutPlanDaySchema>;

/** POST /api/v1/workouts/:id/reparse, path. */
export const reparseWorkoutParamsSchema = z.object({ id: z.string().min(1) });

/**
 * POST /api/v1/workouts/:id/reparse, body. Either field replaces the stored
 * prescription text before parsing, and is saved only when the parse succeeds.
 */
export const reparseWorkoutRouteSchema = z
  .object({
    prescribedMainWorkout: z.string().max(MAX_WORKOUT_TEXT_LEN).nullable().optional(),
    prescribedAccessory: z.string().max(MAX_WORKOUT_TEXT_LEN).nullable().optional(),
  })
  .strict();
export type ReparseWorkoutBody = z.infer<typeof reparseWorkoutRouteSchema>;

/**
 * GET /api/v1/exercises/:exerciseName/history. How many past sessions of one
 * exercise to return. The client asks for a handful to render "last time"; the
 * ceiling keeps a hand-crafted request from pulling an athlete's entire
 * history of a staple lift.
 */
export const exerciseHistoryQuerySchema = z.object({
  sessions: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .openapi({ description: "Most recent sessions (distinct dates) to return; all when omitted" }),
});
export type ExerciseHistoryQuery = z.infer<typeof exerciseHistoryQuerySchema>;

/**
 * POST /api/v1/workouts/combine. The same client-facing create schema as
 * POST /workouts: no planId and no device provenance; combineWorkouts derives
 * planId from the kept plan day. S9 (CODEBASE_ANALYSIS_2026-10-03)
 */
export const combineWorkoutsSchema = z.object({
  newWorkout: insertWorkoutLogRouteSchema,
  deleteWorkoutIds: z.array(z.string().min(1)).min(1).max(10),
  skipPlanDayIds: z.array(z.string().min(1)).max(10).optional(),
});
export type CombineWorkoutsBody = z.infer<typeof combineWorkoutsSchema>;

export const MAX_BULK_DELETE_TARGETS = 100;

/** POST /api/v1/workouts/bulk-delete. At least one, at most 100 ids across both lists. */
export const bulkDeleteWorkoutsSchema = z
  .object({
    workoutLogIds: z.array(z.string().min(1)).max(MAX_BULK_DELETE_TARGETS).default([]),
    planDayIds: z.array(z.string().min(1)).max(MAX_BULK_DELETE_TARGETS).default([]),
  })
  .superRefine((payload, ctx) => {
    const total = payload.workoutLogIds.length + payload.planDayIds.length;
    if (total === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Select at least one workout to delete",
      });
    }
    if (total > MAX_BULK_DELETE_TARGETS) {
      ctx.addIssue({
        code: "custom",
        message: `Select no more than ${MAX_BULK_DELETE_TARGETS} workouts at once`,
      });
    }
  });
export type BulkDeleteWorkoutsBody = z.infer<typeof bulkDeleteWorkoutsSchema>;

/** PATCH /api/v1/workouts/:id/structure-blocks/:blockId/score. A null score clears it. */
export const updateBlockScoreBodySchema = z.object({
  score: structureBlockScoreSchema.nullable(),
});
export type UpdateBlockScoreBody = z.infer<typeof updateBlockScoreBodySchema>;

/**
 * POST /api/v1/workouts/:id/device-link. Exactly one target. The timeline
 * sends whichever the suggestion named, or whatever the athlete picked from
 * the day's rows.
 */
export const linkDeviceActivitySchema = z
  .object({
    planDayId: z.string().min(1).optional(),
    workoutLogId: z.string().min(1).optional(),
  })
  .strict()
  .refine((body) => (body.planDayId ? 1 : 0) + (body.workoutLogId ? 1 : 0) === 1, {
    message: "Provide exactly one of planDayId or workoutLogId",
  });
export type LinkDeviceActivityBody = z.infer<typeof linkDeviceActivitySchema>;

/**
 * Manual MAF test metric corrections. All optional/nullable: an omitted field
 * keeps the auto-pulled (or previously stored) value, an explicit null clears
 * it. Bounds mirror the manual-metrics validation in the client workout form.
 */
export const mafTestMetricsSchema = z
  .object({
    avgHeartRate: z.number().int().min(20).max(250).nullable().optional(),
    maxHeartRate: z.number().int().min(20).max(250).nullable().optional(),
    durationSeconds: z.number().int().positive().max(86_400).nullable().optional(),
    distanceMeters: z.number().nonnegative().max(1_000_000).nullable().optional(),
  })
  .refine(
    (m) => m.avgHeartRate == null || m.maxHeartRate == null || m.maxHeartRate >= m.avgHeartRate,
    { message: "Max heart rate can't be lower than average heart rate." },
  );

/** POST and PATCH /api/v1/workouts/:id/maf-test. */
export const mafTestBodySchema = z.object({
  protocolType: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  metrics: mafTestMetricsSchema.optional(),
});
export type MafTestBody = z.infer<typeof mafTestBodySchema>;

const migrationOwnerTypeSchema = z.enum(["workoutLog", "planDay"]);

/** GET /api/v1/workouts/migration/reviews. ownerType and ownerId go together. */
export const migrationReviewsQuerySchema = z
  .object({
    ownerType: migrationOwnerTypeSchema.optional(),
    ownerId: z.string().min(1).optional(),
  })
  .refine((v) => (v.ownerType && v.ownerId) || (!v.ownerType && !v.ownerId), {
    message: "ownerType and ownerId must be provided together",
  });
export type MigrationReviewsQuery = z.infer<typeof migrationReviewsQuerySchema>;

/** POST /api/v1/workouts/migration/reviews/resolve. */
export const migrationReviewResolveSchema = z.object({
  ownerType: migrationOwnerTypeSchema,
  ownerId: z.string().min(1).max(128),
  action: z.enum(["accept", "reject", "edit"]),
  reason: z.string().max(500).optional().nullable(),
});
export type MigrationReviewResolveBody = z.infer<typeof migrationReviewResolveSchema>;
