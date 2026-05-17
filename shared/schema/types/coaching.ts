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

// Document chunk types
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type InsertDocumentChunk = typeof documentChunks.$inferInsert;

