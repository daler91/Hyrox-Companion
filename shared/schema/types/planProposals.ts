import { planAdjustmentProposals } from "../tables";
import { z } from "../zod";
import { dateStringSchema } from "./requests";

// ---------------------------------------------------------------------------
// Conversational plan editing — the AI coach proposes multi-day plan changes
// from a chat message ("I want to go to a Hyrox class this week"); the user
// applies or dismisses the proposal as one atomic unit.
// ---------------------------------------------------------------------------

/**
 * Fields the coach may change on a plan day. At least one must be present.
 * Mirrors the editable subset of `updatePlanDaySchema` — deliberately narrower:
 * no status/weekNumber/dayName, which stay owned by their dedicated flows.
 */
export const planAdjustmentUpdatedFieldsSchema = z
  .object({
    focus: z.string().min(1).max(200).optional(),
    mainWorkout: z.string().min(1).max(10_000).optional(),
    accessory: z.string().max(10_000).nullable().optional(),
    notes: z.string().max(10_000).nullable().optional(),
    scheduledDate: dateStringSchema.optional(),
    expectedDurationMin: z.number().int().min(1).max(600).nullable().optional(),
    expectedRpe: z.number().int().min(1).max(10).nullable().optional(),
  })
  .refine((fields) => Object.values(fields).some((value) => value !== undefined), {
    message: "updatedFields must contain at least one field",
  });

export type PlanAdjustmentUpdatedFields = z.infer<typeof planAdjustmentUpdatedFieldsSchema>;

/** One per-day change as returned by the LLM (parse-and-validate target). */
export const planAdjustmentChangeSchema = z.object({
  planDayId: z.string().min(1),
  updatedFields: planAdjustmentUpdatedFieldsSchema,
  rationale: z.string().min(1).max(500),
});

export type PlanAdjustmentChange = z.infer<typeof planAdjustmentChangeSchema>;

export const PLAN_ADJUSTMENT_MAX_CHANGES = 14;

/**
 * The full LLM output contract. An empty `changes` array is the coach
 * declining or asking a clarifying question via `summaryMessage`.
 */
export const planAdjustmentLlmOutputSchema = z.object({
  summaryMessage: z.string().min(1).max(2000),
  changes: z.array(planAdjustmentChangeSchema).max(PLAN_ADJUSTMENT_MAX_CHANGES),
});

export type PlanAdjustmentLlmOutput = z.infer<typeof planAdjustmentLlmOutputSchema>;

/**
 * Change classification, derived server-side from the updated fields (never
 * trusted from the LLM, which can emit self-inconsistent labels).
 */
export const planAdjustmentChangeKindSchema = z.enum([
  "reschedule",
  "workout_update",
  "rest_conversion",
  "tune",
]);

export type PlanAdjustmentChangeKind = z.infer<typeof planAdjustmentChangeKindSchema>;

/**
 * Snapshot of the plan day at proposal time. Used to render the before→after
 * diff card and to detect staleness at apply time (fingerprint + status).
 */
export const planAdjustmentBaselineSchema = z.object({
  focus: z.string(),
  mainWorkout: z.string(),
  accessory: z.string().nullable(),
  notes: z.string().nullable(),
  scheduledDate: z.string().nullable(),
  expectedDurationMin: z.number().nullable(),
  expectedRpe: z.number().nullable(),
  status: z.string(),
  fingerprint: z.string().optional(),
});

export type PlanAdjustmentBaseline = z.infer<typeof planAdjustmentBaselineSchema>;

/** A change enriched by the server before persistence. */
export const enrichedPlanAdjustmentChangeSchema = planAdjustmentChangeSchema.extend({
  kind: planAdjustmentChangeKindSchema,
  /** e.g. "Thu Jul 16 — Tempo Run" for the diff card. */
  dayLabel: z.string(),
  baseline: planAdjustmentBaselineSchema,
  /** Day has structured exercise_sets rows (table-backed prescription). */
  structured: z.boolean(),
  /** Day has EMOM/AMRAP structure blocks — text prescription edits are forbidden. */
  hasStructureBlocks: z.boolean(),
});

export type EnrichedPlanAdjustmentChange = z.infer<typeof enrichedPlanAdjustmentChangeSchema>;

export const planAdjustmentProposalPayloadSchema = z.object({
  changes: z.array(enrichedPlanAdjustmentChangeSchema),
});

export type PlanAdjustmentProposalPayload = z.infer<typeof planAdjustmentProposalPayloadSchema>;

export const planProposalStatusSchema = z.enum([
  "pending",
  "applied",
  "dismissed",
  "superseded",
  "invalidated",
]);

export type PlanProposalStatus = z.infer<typeof planProposalStatusSchema>;

export type PlanAdjustmentProposal = typeof planAdjustmentProposals.$inferSelect;
export type InsertPlanAdjustmentProposal = typeof planAdjustmentProposals.$inferInsert;

/** Chat-intent classifier output (fast-model JSON call). */
export const chatIntentResultSchema = z.object({
  intent: z.enum(["plan_modification", "normal_chat"]),
  confidence: z.number().min(0).max(1),
});

export type ChatIntentResult = z.infer<typeof chatIntentResultSchema>;
