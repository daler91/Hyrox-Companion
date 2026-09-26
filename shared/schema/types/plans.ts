import { planDayPriorityEnum, planDayRecoveryEnum } from "../enums";
import { planDays, trainingPlans } from "../tables";
import { createInsertSchema, z } from "../zod";
import { dateStringSchema } from "./requests";
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

/**
 * Optional body for `POST /api/v1/plans/sample`. Onboarding passes the goal the
 * athlete picked and any race date they gave, which used to be discarded for
 * template users (onboarding audit M3). An empty body keeps the old behaviour.
 */
export const createSamplePlanSchema = z
  .object({
    goal: z.string().trim().max(500).optional(),
    raceDate: dateStringSchema.optional(),
  })
  .default({});

/**
 * Archive a plan effective a date, or restore it with `null`. The route clamps
 * the date forward to the athlete's own today — see the handler for why a
 * back-dated retirement is refused rather than honoured.
 */
export const updateTrainingPlanRetirementSchema = z.object({
  retiredOn: dateStringSchema.nullable(),
});

/**
 * `training_plans.engine_state`: what the workout engine remembers about a
 * plan between adaptation passes. Server-managed — no client schema accepts it.
 */
export const planEngineStateSchema = z.object({
  version: z.literal(1),
  /** The run fitness (VDOT) the plan's paces are written against; null = paces by effort. */
  runVdot: z.number().positive().nullable(),
  /** Workout logs already adapted into the plan, oldest first and bounded, so each counts once. */
  adaptedLogIds: z.array(z.string().max(255)).max(200),
  updatedAt: z.string(),
});
export type PlanEngineState = z.infer<typeof planEngineStateSchema>;

export type UpdateTrainingPlanGoal = z.infer<typeof updateTrainingPlanGoalSchema>;
export type CreateSamplePlanInput = z.infer<typeof createSamplePlanSchema>;
export type UpdateTrainingPlanRetirement = z.infer<typeof updateTrainingPlanRetirementSchema>;
export type InsertTrainingPlan = z.infer<typeof insertTrainingPlanSchema>;
export type TrainingPlan = typeof trainingPlans.$inferSelect;

// Plan day types and schemas
export const insertPlanDaySchema = createInsertSchema(planDays)
  .omit({
    id: true,
  })
  .extend({
    status: z.enum(["planned", "completed", "missed", "skipped"]).default("planned"),
    expectedDurationMin: z.number().int().min(1).max(600).nullable().optional(),
    expectedRpe: z.number().int().min(1).max(10).nullable().optional(),
    // Planned local start time as minutes-from-midnight (0–1439); drives which
    // meals are the pre/recovery meals in the per-meal fuel targets.
    plannedTimeOfDayMin: z.number().int().min(0).max(1439).nullable().optional(),
    // null hands the tier back to the server's inference.
    priority: z.enum(planDayPriorityEnum).nullable().optional(),
    recovery: z.enum(planDayRecoveryEnum).nullable().optional(),
  });

export const updatePlanDaySchema = insertPlanDaySchema.partial().omit({
  planId: true,
});

/**
 * What a CLIENT may PATCH on a plan day.
 *
 * `updatePlanDaySchema` above is the internal write surface — coachService and
 * aiSuggestionService legitimately set the AI-provenance columns and status
 * through it — but those columns are server-managed and were reachable from
 * `PATCH /api/v1/plans/:planId/days/:dayId`. Writing them directly bypassed the
 * status-transition rules in `updatePlanDayStatus` (which is why the dedicated
 * `/status` route exists) and the coach-note regeneration cooldown keyed on
 * `aiNoteUpdatedAt`, letting a client re-trigger AI note generation at will.
 *
 * `recovery` and `missedOn` are written only by missed-session recovery
 * (`POST /api/v1/plans/days/:dayId/recovery`) and the reschedule path, which
 * move the status with them. `priority` stays writable: it is the athlete's.
 */
export const updatePlanDayRouteSchema = updatePlanDaySchema.omit({
  status: true,
  skipReason: true,
  recovery: true,
  missedOn: true,
  aiSource: true,
  aiRationale: true,
  aiInputsUsed: true,
  aiNoteUpdatedAt: true,
});

export type InsertPlanDay = z.infer<typeof insertPlanDaySchema>;
export type UpdatePlanDay = z.infer<typeof updatePlanDaySchema>;
export type UpdatePlanDayRouteBody = z.infer<typeof updatePlanDayRouteSchema>;
export type PlanDay = typeof planDays.$inferSelect;

export const coachModificationKindSchema = z.enum([
  "fatigue_volume_reduction",
  "workload_adjustment",
  // The workout engine moved the day's loads or paces to follow a logged
  // session (server/services/workoutEngine/adaptation.ts).
  "auto_progression",
]);

/** One load or pace the workout engine moved, for the coach note's detail. */
export const progressionChangeSchema = z.object({
  exercise: z.string().max(100),
  kind: z.enum(["raise", "hold", "deload", "pace"]),
  from: z.number(),
  to: z.number(),
  /** The athlete's weight unit, or "vdot" for a pace change. */
  unit: z.string().max(16),
});
export type ProgressionChangeRecord = z.infer<typeof progressionChangeSchema>;

const loadGovernorAcwrZoneSchema = z.enum([
  "insufficient_data",
  "undertraining",
  "sweet_spot",
  "yellow",
  "danger",
]);

const loadGovernorVectorSchema = z.enum([
  "posterior_chain",
  "anterior_chain",
  "unilateral_stability",
  "elastic_tendon",
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
  loadGovernorAcwrZone: loadGovernorAcwrZoneSchema.optional(),
  loadGovernorAcwr: z.number().optional(),
  loadGovernorFlaggedVectors: z.array(loadGovernorVectorSchema).optional(),
  loadGovernorRestrictions: z.array(z.string()).optional(),
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
  // What an auto-progression changed on this day, when that is what the note is.
  progressionChanges: z.array(progressionChangeSchema).max(10).optional(),
  lastFatigueReduction: coachFatigueReductionMetadataSchema.optional(),
  // Snapshot of the prescription that was swapped out when the coach converted
  // this day to a different session (e.g. a strength day downshifted to a
  // recovery run). Surfaced as an "Originally planned" reference on the coach
  // note so the athlete can still see what was replaced.
  replacedPrescription: z
    .object({
      focus: z.string(),
      mainWorkout: z.string(),
      accessory: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type CoachNoteInputs = z.infer<typeof coachNoteInputsSchema>;

export type TrainingPlanWithDays = TrainingPlan & {
  days: PlanDay[];
};

