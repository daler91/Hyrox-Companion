import { planAdjustmentProposals } from "../tables";
import { z } from "../zod";
import type { CoachNoteInputs, PlanDay } from "./plans";
import { calendarDateSchema } from "./requests";
import type { ExerciseSet } from "./workouts";

// ---------------------------------------------------------------------------
// Conversational plan editing — the AI coach proposes multi-day plan changes
// from a chat message ("I want to go to a Hyrox class this week"); the user
// applies all of them or the ones they pick, dismisses them, or undoes an apply.
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
    // A real day: an impossible one reached the plan-day date column on apply (C50).
    scheduledDate: calendarDateSchema.optional(),
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
  // Applied, then undone by the athlete.
  "reverted",
]);

export type PlanProposalStatus = z.infer<typeof planProposalStatusSchema>;

/** `POST /api/v1/plan-proposals/:id/apply`: no body, or the days to apply. */
export const applyPlanProposalRequestSchema = z
  .object({
    /** The changes to apply, by plan day. Absent means every change. */
    planDayIds: z.array(z.string().min(1).max(255)).min(1).max(PLAN_ADJUSTMENT_MAX_CHANGES).optional(),
  })
  // A POST without a body applies every change, as before the athlete could pick.
  .default({});

export type ApplyPlanProposalRequest = z.infer<typeof applyPlanProposalRequestSchema>;

/** How long after an apply the athlete can still undo it. */
export const PLAN_PROPOSAL_UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** The plan-day fields an apply can change, and an undo can put back. */
export const PLAN_PROPOSAL_UNDO_FIELDS = [
  "focus",
  "mainWorkout",
  "accessory",
  "notes",
  "scheduledDate",
  "expectedDurationMin",
  "expectedRpe",
] as const;

export type PlanProposalUndoField = (typeof PLAN_PROPOSAL_UNDO_FIELDS)[number];

/** A value the apply replaced, and the value it wrote. */
export interface PlanProposalFieldUndo<T> {
  before: T;
  after: T;
}

/**
 * What an apply wrote to one plan day, kept so the athlete can take it back.
 * Anything changed since is the athlete's (or a later coach note's) and stays:
 * a field, the coach note or the exercise table comes back only while it still
 * reads what the apply wrote, the rule `plan_days.recovery_undo` follows.
 */
export interface PlanProposalDayUndo {
  planDayId: string;
  fields: { [K in PlanProposalUndoField]?: PlanProposalFieldUndo<PlanDay[K]> };
  /** The coach note the apply replaced, and when the apply wrote its own. */
  coachNote: {
    before: {
      aiSource: string | null;
      aiRationale: string | null;
      aiNoteUpdatedAt: string | null;
      aiInputsUsed: CoachNoteInputs | null;
    };
    writtenAt: string;
  };
  /** The exercise table before the apply replaced or cleared it, and a fingerprint of the table it left. */
  sets?: { before: ExerciseSet[]; afterFingerprint: string };
}

/** `plan_adjustment_proposals.apply_undo`: one entry per day the apply changed. */
export interface PlanProposalApplyUndo {
  days: PlanProposalDayUndo[];
}

export type PlanAdjustmentProposal = typeof planAdjustmentProposals.$inferSelect;
export type InsertPlanAdjustmentProposal = typeof planAdjustmentProposals.$inferInsert;

/** Chat-intent classifier output (fast-model JSON call). */
export const chatIntentResultSchema = z.object({
  intent: z.enum(["plan_modification", "normal_chat"]),
  confidence: z.number().min(0).max(1),
});

export type ChatIntentResult = z.infer<typeof chatIntentResultSchema>;
