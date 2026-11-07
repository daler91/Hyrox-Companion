import { z } from "../zod";
import { insertCoachingMaterialSchema } from "./coaching";

// Request schemas for the coach area (chat, coaching materials, timeline AI
// suggestions). They live here, not beside their routes, so the route
// validation and the OpenAPI document (shared/openapiRoutes/coach.ts) are the
// same object and cannot drift apart.

/** Body of `POST /api/v1/coaching-materials`; the owner comes from the session. */
export const createCoachingMaterialSchema = insertCoachingMaterialSchema.omit({ userId: true });
export type CreateCoachingMaterial = z.infer<typeof createCoachingMaterialSchema>;

/** Body of `PATCH /api/v1/coaching-materials/:id`: any subset of the editable fields. */
export const updateCoachingMaterialSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  content: z.string().trim().min(1).max(1500000).optional(),
  type: z.enum(["principles", "document"]).optional(),
});
export type UpdateCoachingMaterial = z.infer<typeof updateCoachingMaterialSchema>;

/**
 * Query of `GET /api/v1/chat/history`. Cursor-paginated: the response's
 * `X-Next-Cursor` (timestamp) and `X-Next-Cursor-Id` (row id) headers come
 * back as `before` and `beforeId`, always together, so rows that share a
 * millisecond are not dropped.
 */
export const chatHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().min(1).max(255).optional(),
    // A workout's conversation; without either, the general one (I4).
    focusPlanDayId: z.string().min(1).max(255).optional(),
    focusWorkoutLogId: z.string().min(1).max(255).optional(),
  })
  .refine((q) => (q.before == null) === (q.beforeId == null), {
    message: "before and beforeId must be provided together",
  });
export type ChatHistoryQuery = z.infer<typeof chatHistoryQuerySchema>;

/** Body of `POST /api/v1/timeline/ai-suggestions/apply`: one suggestion, as the suggestions call returned it. */
export const applyTimelineSuggestionSchema = z.object({
  workoutId: z.string().min(1).max(128),
  targetField: z.enum(["notes", "mainWorkout", "accessory"]),
  action: z.enum(["replace", "append"]),
  recommendation: z.string().min(1).max(10_000),
  rationale: z.string().max(2_000).nullable().optional(),
  aiSource: z.enum(["rag", "legacy", "none"]).nullable().optional(),
});
export type ApplyTimelineSuggestionBody = z.infer<typeof applyTimelineSuggestionSchema>;
