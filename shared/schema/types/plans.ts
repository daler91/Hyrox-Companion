import { planDays, trainingPlans } from "../tables";
import { createInsertSchema, z } from "../zod";
// Training plan types and schemas
export const insertTrainingPlanSchema = createInsertSchema(trainingPlans)
  .omit({
    id: true,
  })
  .extend({
    goal: z.string().max(500).nullable().optional(),
  });

export const updateTrainingPlanGoalSchema = z.object({
  goal: z.string().max(500).nullable(),
});

export type UpdateTrainingPlanGoal = z.infer<typeof updateTrainingPlanGoalSchema>;
export type InsertTrainingPlan = z.infer<typeof insertTrainingPlanSchema>;
export type TrainingPlan = typeof trainingPlans.$inferSelect;

// Plan day types and schemas
export const insertPlanDaySchema = createInsertSchema(planDays)
  .omit({
    id: true,
  })
  .extend({
    status: z.enum(["planned", "completed", "missed", "skipped"]).default("planned"),
  });

export const updatePlanDaySchema = insertPlanDaySchema.partial().omit({
  planId: true,
});

export type InsertPlanDay = z.infer<typeof insertPlanDaySchema>;
export type UpdatePlanDay = z.infer<typeof updatePlanDaySchema>;
export type PlanDay = typeof planDays.$inferSelect;

export const coachModificationKindSchema = z.enum([
  "fatigue_volume_reduction",
  "workload_adjustment",
]);

const coachModificationMetadataSchema = z.object({
  kind: coachModificationKindSchema,
  reason: z.string().max(400).optional(),
  at: z.string().optional(),
  completedWorkoutCount: z.number().int().nonnegative().optional(),
  fatigueFlag: z.boolean().optional(),
  rpeTrend: z.enum(["rising", "stable", "falling", "insufficient_data"]).optional(),
  prescriptionFingerprint: z.string().optional(),
});

const coachFatigueReductionMetadataSchema = coachModificationMetadataSchema.extend({
  kind: z.literal("fatigue_volume_reduction"),
});

/**
 * Compact audit of which inputs drove the coach's note for a plan day.
 * Persisted as `plan_days.ai_inputs_used` (jsonb) and shown on the
 * workout card so the athlete can see what the coach was weighing.
 */
export const coachNoteInputsSchema = z.object({
  rpeTrend: z.enum(["rising", "stable", "falling", "insufficient_data"]).optional(),
  fatigueFlag: z.boolean().optional(),
  planPhase: z.enum(["early", "build", "peak", "taper", "race_week"]).optional(),
  weeklyVolumeTrend: z.enum(["increasing", "stable", "decreasing"]).optional(),
  stationGaps: z.array(z.string()).optional(),
  progressionFlags: z.array(z.string()).optional(),
  ragUsed: z.boolean().optional(),
  recentWorkoutCount: z.number().int().nonnegative().optional(),
  completedWorkoutCount: z.number().int().nonnegative().optional(),
  planGoalPresent: z.boolean().optional(),
  recommendationTrace: z
    .object({
      trainingStyleId: z.string(),
      phase: z.string(),
      strategyRuleVersion: z.string(),
      promptBundleVersion: z.string(),
      rationaleCodes: z.array(z.string()).optional(),
    })
    .optional(),
  lastModification: coachModificationMetadataSchema.optional(),
  lastFatigueReduction: coachFatigueReductionMetadataSchema.optional(),
});
export type CoachNoteInputs = z.infer<typeof coachNoteInputsSchema>;

export type TrainingPlanWithDays = TrainingPlan & {
  days: PlanDay[];
};

