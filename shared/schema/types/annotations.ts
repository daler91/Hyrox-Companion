import { timelineAnnotations } from "../tables";
import { createInsertSchema, z } from "../zod";
// Timeline annotations — user-authored date ranges (injury, illness, etc.)
// that explain volume dips in the training history.
export type TimelineAnnotationType = "injury" | "illness" | "travel" | "rest";
export const TIMELINE_ANNOTATION_TYPES: readonly TimelineAnnotationType[] = [
  "injury",
  "illness",
  "travel",
  "rest",
];

export type TimelineAnnotation = typeof timelineAnnotations.$inferSelect;

export const insertTimelineAnnotationSchema = createInsertSchema(timelineAnnotations)
  .omit({ id: true, userId: true, createdAt: true, updatedAt: true })
  .extend({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
    type: z.enum(["injury", "illness", "travel", "rest"]),
    note: z.string().max(500, "Note must be 500 characters or less").nullable().optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

export type InsertTimelineAnnotation = z.infer<typeof insertTimelineAnnotationSchema>;

// Partial update schema — users can change any subset of the editable
// fields. The same date ordering constraint is enforced when both dates
// are present.
export const updateTimelineAnnotationSchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    type: z.enum(["injury", "illness", "travel", "rest"]).optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((data) => !(data.startDate && data.endDate) || data.endDate >= data.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

export type UpdateTimelineAnnotation = z.infer<typeof updateTimelineAnnotationSchema>;

