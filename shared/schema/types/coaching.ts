import { coachingMaterials, documentChunks } from "../tables";
import { createInsertSchema, z } from "../zod";
// Coaching material types and schemas
export const insertCoachingMaterialSchema = createInsertSchema(coachingMaterials)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(255, "Title must be 255 characters or less"),
    content: z
      .string()
      .trim()
      .min(1, "Content is required")
      .max(1500000, "Content must be 1,500,000 characters or less"),
    type: z.enum(["principles", "document"]),
  });

export type InsertCoachingMaterial = z.infer<typeof insertCoachingMaterialSchema>;
export type CoachingMaterial = typeof coachingMaterials.$inferSelect;

/**
 * A material as the Settings list shows it (`GET /api/v1/coaching-materials/summaries`):
 * its text left out and its length counted by the server. The list used to
 * download every material's full text, up to 1.5M characters each, to show
 * that length. PF4 (CODEBASE_ANALYSIS_2026-10-03)
 */
export type CoachingMaterialSummary = Omit<CoachingMaterial, "content" | "userId"> & {
  contentLength: number;
};

// Document chunk types
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type InsertDocumentChunk = typeof documentChunks.$inferInsert;


/**
 * A prompt chip under the coach chat. `message` is what sending it says; the
 * label alone when absent. The `suggestions` id runs the workout-suggestions
 * flow instead of sending a message.
 */
export interface CoachQuickAction {
  id: string;
  label: string;
  message?: string;
}

/** `GET /api/v1/chat/welcome`: the coach's opening line and prompt chips, built from the athlete's training. */
export interface CoachWelcome {
  greeting: string;
  quickActions: CoachQuickAction[];
}
