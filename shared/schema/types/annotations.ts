import { timelineAnnotations } from "../tables";
import { createInsertSchema, z } from "../zod";
import { calendarDateSchema } from "./requests";
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

/** Run the date-order check only on real dates, so a bad date is named once. */
function datesValid({ issues }: { readonly issues: readonly unknown[] }): boolean {
  return issues.length === 0;
}

// Real calendar days: the shape check alone took "2026-02-30", which the date
// columns refused with a 500 (C50, CODEBASE_ANALYSIS_2026-10-03).
export const insertTimelineAnnotationSchema = createInsertSchema(timelineAnnotations)
  .omit({ id: true, userId: true, createdAt: true, updatedAt: true })
  .extend({
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
    type: z.enum(["injury", "illness", "travel", "rest"]),
    note: z.string().max(500, "Note must be 500 characters or less").nullable().optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
    when: datesValid,
  });

export type InsertTimelineAnnotation = z.infer<typeof insertTimelineAnnotationSchema>;

// Partial update schema — users can change any subset of the editable
// fields. The same date ordering constraint is enforced when both dates
// are present.
export const updateTimelineAnnotationSchema = z
  .object({
    startDate: calendarDateSchema.optional(),
    endDate: calendarDateSchema.optional(),
    type: z.enum(["injury", "illness", "travel", "rest"]).optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((data) => !(data.startDate && data.endDate) || data.endDate >= data.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
    when: datesValid,
  });

export type UpdateTimelineAnnotation = z.infer<typeof updateTimelineAnnotationSchema>;

