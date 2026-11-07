import type { OpenAPIRegistry, ResponseConfig, RouteConfig } from "@asteasolutions/zod-to-openapi";
import { createSelectSchema } from "drizzle-zod";

import {
  addExerciseSetBodySchema,
  applyMissedRecoverySchema,
  applyPlanProposalRequestSchema,
  createSamplePlanSchema,
  exerciseSetOrderBodySchema,
  generatePlanInputSchema,
  importPlanRequestSchema,
  parseExercisesFromImageRequestSchema,
  patchExerciseSetBodySchema,
  planDayPriorityEnum,
  planDayRecoveryEnum,
  planDays,
  planDaySkipReasonEnum,
  recoveryNoteCodes,
  schedulePlanRequestSchema,
  trainingPlans,
  updatePlanDayRouteSchema,
  updateTrainingPlanGoalSchema,
  updateTrainingPlanRetirementSchema,
  workoutStatusEnum,
} from "../schema";
import {
  patchDayStatusSchema,
  planDayReparseBodySchema,
  planDayStructureBodySchema,
  renameTrainingPlanSchema,
} from "../schema/types/plansRequests";
import { z } from "../schema/zod";
import type { OpenApiCommon } from "./common";
import type { EntityComponents } from "./entities";

/**
 * Training plans, their days and each day's prescribed exercise table
 * (server/routes/plans.ts), missed-session recovery (planRecovery.ts) and the
 * coach's plan-change proposals (planProposals.ts).
 */
export function registerPlansPaths(registry: OpenAPIRegistry, common: OpenApiCommon, entities: EntityComponents): void {
  const ctx = createContext(registry, common);
  const schemas = registerPlanSchemas(registry, entities);
  registerPlanRoutes(ctx, schemas);
  registerPlanDayRoutes(ctx, schemas);
  registerPlanDayAiRoutes(ctx, schemas);
  registerProposalRoutes(ctx, schemas);
}

/** server/routes/planRecovery.ts RECOVERY_PATH, in OpenAPI form. */
const RECOVERY_PATH = "/api/v1/plans/days/{dayId}/recovery";
const GENERATION_STATUSES = ["pending", "generating", "ready", "failed"] as const;

const json = (schema: z.ZodType) => ({ "application/json": { schema } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
/** A schema with a description. */
const d = <T extends z.ZodType>(schema: T, description: string): T => schema.openapi({ description });
const opaque = (description: string) => d(z.record(z.string(), z.unknown()).nullable(), description);
const day = (description: string) => z.string().openapi({ description, example: "2026-03-30" });
/** Register a named object component. */
const named = <T extends z.ZodRawShape>(registry: OpenAPIRegistry, name: string, description: string, shape: T) =>
  registry.register(name, z.object(shape).openapi({ description }));

type Responses = Record<number, ResponseConfig>;
type Operation = Omit<RouteConfig, "security" | "tags"> & { tags?: string[] };
type Context = ReturnType<typeof createContext>;
type Schemas = ReturnType<typeof registerPlanSchemas>;

const AiLimitedResponse = z.object({
  error: z.string(),
  code: z.string().openapi({ description: "RATE_LIMITED or AI_BUDGET_EXCEEDED", example: "AI_BUDGET_EXCEEDED" }),
  currentCostCents: d(z.number().int().optional(), "AI_BUDGET_EXCEEDED only: the athlete's rolling 24-hour AI spend"),
  limitCents: d(z.number().int().optional(), "AI_BUDGET_EXCEEDED only: the daily limit"),
});

function createContext(registry: OpenAPIRegistry, common: OpenApiCommon) {
  return {
    common,
    /** Register an authenticated operation, tagged Plans unless it says otherwise. */
    op: (config: Operation): void => {
      registry.registerPath({ tags: ["Plans"], security: common.security, ...config });
    },
    notFound: (what: string): Responses => common.error(404, `NOT_FOUND: no such ${what} for this athlete`),
    /**
     * A 400 that is either the Zod middleware's envelope (malformed body) or a
     * handler's own `{ error, code }` refusal of a well-formed one.
     */
    badRequest: (description: string): Responses => ({
      400: {
        description,
        content: {
          "application/json": { schema: { oneOf: [ref("ValidationErrorResponse"), ref("ErrorResponse")] } },
        },
      },
    }),
    /** aiConsentCheck. */
    aiConsent: (): Responses =>
      common.error(403, "AI_COACH_DISABLED: the athlete has not turned on AI coaching (Settings)"),
    /**
     * aiBudgetCheck's 429 (merged with the rate limiter's) and 503. Spread
     * AFTER common.authenticatedResponses() so this 429 replaces the plain one.
     */
    aiBudget: (more429 = ""): Responses => ({
      429: {
        description: `RATE_LIMITED (Retry-After says when to try again), or AI_BUDGET_EXCEEDED: the athlete's rolling 24-hour AI spend is used up${more429}`,
        content: json(AiLimitedResponse),
      },
      ...common.error(503, "AI_FEATURES_DISABLED (operator switch), AI_GLOBAL_BUDGET_EXCEEDED (app-wide AI cap reached) or AI_BUDGET_UNAVAILABLE (the budget check failed)"),
    }),
  };
}

// ---------------------------------------------------------------------------
// Parameters and response shapes
// ---------------------------------------------------------------------------

const planId = z.string().openapi({ description: "Training plan id", example: "6b1f0c9e-2d3a-4c5b-8e7f-1a2b3c4d5e6f" });
const dayId = z.string().openapi({ description: "Plan day id", example: "0c9e6b1f-3a2d-5b4c-7f8e-6f5e4d3c2b1a" });
const PlanParams = z.object({ id: planId });
const ScopedPlanParams = z.object({ planId });
const DayParams = z.object({ dayId });
const PlanDayParams = z.object({ planId: d(planId, "Training plan id. Not checked: the day is found by dayId alone"), dayId });
const DaySetParams = z.object({ dayId, setId: d(z.string(), "Exercise set id") });
const ProposalParams = z.object({ id: d(z.string(), "Proposal id") });

const RecycledResponse = (what: string) =>
  z.object({
    success: z.literal(true),
    recycleBinItemId: d(z.string(), `Recycle-bin item holding the deleted ${what}; POST /api/v1/recycle-bin/{id}/restore undoes the delete for 90 days`),
  });

const DayLabel = z.object({
  planDayId: z.string(),
  dayLabel: z.string().openapi({ example: "Thu Jul 16 — Tempo Run" }),
});

function registerPlanSchemas(registry: OpenAPIRegistry, entities: EntityComponents) {
  const TrainingPlan = registry.register(
    "TrainingPlan",
    createSelectSchema(trainingPlans)
      .extend({
        generationStatus: d(z.enum(GENERATION_STATUSES), "AI generation progress; `ready` for imported and sample plans"),
        generationError: d(z.string().nullable(), "Client-safe message when generation failed"),
        retiredOn: d(z.string().nullable(), "YYYY-MM-DD the plan was archived from (dates before it still count); null while live"),
        engineState: opaque("Server-managed workout-engine state. Opaque to clients."),
      })
      .openapi({ description: "A stored training plan row (without its days)" }),
  );

  const PlanDay = registry.register(
    "PlanDay",
    createSelectSchema(planDays)
      .extend({
        status: z.enum(workoutStatusEnum).nullable(),
        skipReason: d(z.enum(planDaySkipReasonEnum).nullable(), "Set only while status is skipped"),
        priority: d(z.enum(planDayPriorityEnum).nullable(), "The athlete's tier for the session; null = inferred from the session"),
        recovery: d(z.enum(planDayRecoveryEnum).nullable(), "What the athlete decided after missing the session; null = no decision"),
        missedOn: d(z.string().nullable(), "YYYY-MM-DD the session was missed on, when recovery moved it; null otherwise"),
        aiInputsUsed: d(entities.CoachNoteInputs.nullable(), "Which inputs drove the coach note (aiRationale)"),
        recoveryUndo: opaque("Server-managed record of the last fold or shorten, used by recovery `reopen`. Opaque to clients."),
      })
      .openapi({ description: "A stored plan day row" }),
  );

  const TrainingPlanWithDays = registry.register(
    "TrainingPlanWithDays",
    TrainingPlan.extend({
      days: d(z.array(PlanDay), "Ordered by week, then Monday to Sunday"),
    }).openapi({ description: "A training plan with every one of its days" }),
  );

  // One component each across the document (shared/openapiRoutes/entities.ts).
  const PlanDayExerciseSet = entities.ExerciseSetRow;
  const PlanDayStructureBlock = entities.WorkoutStructureBlock;

  const PlanDaySetsAndStructure = named(registry, "PlanDaySetsAndStructure", "A plan day's prescribed exercise rows and structure blocks", {
    exerciseSets: d(z.array(PlanDayExerciseSet), "By sortOrder"),
    structureBlocks: d(z.array(PlanDayStructureBlock), "By sortOrder"),
  });

  return {
    ...{ TrainingPlan, PlanDay, TrainingPlanWithDays, PlanDayExerciseSet, PlanDaySetsAndStructure },
    ...registerPlanDayAiSchemas(registry, entities),
    ...registerRecoverySchemas(registry),
    ...registerProposalSchemas(registry, entities),
  };
}

/** The reparse result; exercises are the shared ParsedExercise (shared/schema/types/workouts.ts). */
function registerPlanDayAiSchemas(registry: OpenAPIRegistry, entities: EntityComponents) {
  const { ParsedExercise } = entities;
  const PlanDayReparseResponse = named(registry, "PlanDayReparseResponse", "Result of parsing text or a photo into a plan day's prescription", {
    exercises: d(z.array(ParsedExercise), "The exercises the parse accepted (already saved; refetch the day's sets for the rows)"),
    saved: z.literal(true),
    setCount: d(z.number().int(), "Exercise set rows now on the day (at least 1)"),
    rejectedCount: d(z.number().int(), "Parsed rows dropped as invalid"),
    rejectionReasons: z.array(z.string()),
  });
  return { PlanDayReparseResponse };
}

/** Missed-session recovery: the interfaces in shared/schema/types/recovery.ts. */
function registerRecoverySchemas(registry: OpenAPIRegistry) {
  /** One Monday-to-Sunday week an option changes, before and after it. */
  const WeekImpact = z.object({
    weekStart: day("The week's Monday"),
    minutesBefore: z.number(),
    minutesAfter: z.number(),
    loadBefore: d(z.number(), "Training load (UTSS)"),
    loadAfter: z.number(),
    keyBefore: d(z.number().int(), "Key sessions done or still planned"),
    keyAfter: z.number().int(),
    keyScheduled: d(z.number().int(), "Key sessions scheduled, whatever became of them"),
  });
  /** A session already on a candidate day. */
  const DaySession = z.object({
    focus: z.string(),
    priority: d(z.enum(planDayPriorityEnum).nullable(), "Null for an off-plan logged session"),
    durationMin: z.number(),
    status: z.enum(["planned", "completed"]),
  });
  const PlanDayRecoveryImpact = named(registry, "PlanDayRecoveryImpact", "What one recovery option does to the plan", {
    summary: d(z.string(), "One plain sentence: what happens"),
    keptFraction: d(z.number(), "Share of the session put back on the calendar: 1, about 0.6, or 0"),
    keptMinutes: z.number(),
    day: d(z.object({ date: day("YYYY-MM-DD the session lands on"), minutesAfter: z.number() }).nullable(), "Where the session lands and that day's training minutes with it; null when it does not move"),
    weeks: d(z.array(WeekImpact), "Every week whose numbers the option changes, oldest first"),
    notes: z.array(z.object({ code: z.enum(recoveryNoteCodes), tone: z.enum(["warning", "info"]), message: z.string() })),
  });

  const PlanDayRecoveryTarget = named(registry, "PlanDayRecoveryTarget", "A day the missed session could move to, and what moving it there does", {
    date: day("YYYY-MM-DD the session could move to"),
    sessions: d(z.array(DaySession), "What is already on that day; empty for a free day"),
    impact: PlanDayRecoveryImpact,
  });

  const PlanDayRecoveryMoveOption = named(registry, "PlanDayRecoveryMoveOption", "Fold or shorten: the days the session could move to", {
    available: z.boolean(),
    unavailableReason: z.string().nullable(),
    suggestedDate: d(z.string().nullable(), "The best of targets (YYYY-MM-DD); null when there are none"),
    targets: d(z.array(PlanDayRecoveryTarget), "Candidate days, soonest first"),
  });

  const PlanDayRecoveryPreview = named(registry, "PlanDayRecoveryPreview", "What each way forward for a missed session would do to the plan", {
    planDayId: z.string(),
    missedDate: day("YYYY-MM-DD the session was missed on"),
    focus: z.string(),
    priority: z.enum(planDayPriorityEnum),
    recovery: d(z.enum(planDayRecoveryEnum).nullable(), "The decision already on the day: let_go, or a previous fold/shorten"),
    today: day("The athlete's own calendar date"),
    session: z.object({
      durationMin: z.number(),
      estimated: d(z.boolean(), "True when the length is an assumption"),
      rpe: z.number(),
      hard: d(z.boolean(), "Key, or RPE 7+"),
    }),
    recommendation: z.object({
      action: z.enum(["fold", "shorten", "let_go"]),
      targetDate: d(z.string().nullable(), "The suggested day for fold/shorten; null for let_go"),
      reason: z.string(),
    }),
    fold: PlanDayRecoveryMoveOption,
    shorten: PlanDayRecoveryMoveOption.extend({
      durationMin: d(z.number(), "The shortened session's length"),
      keptFraction: z.number(),
      changes: d(z.array(z.object({ label: z.string(), from: z.string(), to: z.string() })), 'What shortening cuts, e.g. "Interval run: 5 sets → 3"'),
    }).openapi({ description: "Shorten: the same choice of days as fold, moving about 60% of the session" }),
    letGo: z.object({ impact: PlanDayRecoveryImpact }),
  });
  return { PlanDayRecoveryPreview };
}

function registerProposalSchemas(registry: OpenAPIRegistry, entities: EntityComponents) {
  const { PlanProposal } = entities;

  const PlanProposalApplyFailure = named(registry, "PlanProposalApplyFailure", "An apply refused before anything was written", {
    applied: z.literal(false),
    reason: z.enum(["invalid_selection", "not_pending", "stale"]),
    message: z.string(),
    staleChanges: d(z.array(DayLabel).optional(), "stale only: the days that changed since the proposal was made"),
  });
  return { PlanProposal, PlanProposalApplyFailure };
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

function registerPlanRoutes({ op, common, notFound, badRequest, aiConsent, aiBudget }: Context, s: Schemas): void {
  op({
    method: "get",
    path: "/api/v1/plans",
    summary: "List training plans",
    description: "Every plan the athlete owns, retired ones included, live plans first then newest start date first.",
    responses: {
      200: { description: "The plans (without their days)", content: json(z.array(s.TrainingPlan)) },
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "get",
    path: "/api/v1/plans/{id}",
    summary: "Get a training plan with its days",
    request: { params: PlanParams },
    responses: {
      200: { description: "The plan and every day", content: json(s.TrainingPlanWithDays) },
      ...notFound("plan"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "post",
    path: "/api/v1/plans/import",
    summary: "Import a training plan from CSV",
    description: "Creates an unscheduled plan from CSV text (columns Week, Day, Focus, Main Workout, Accessory, Notes). Schedule it with POST /api/v1/plans/{planId}/schedule. Body limit 1 MB.",
    request: { body: { required: true, content: json(importPlanRequestSchema) } },
    responses: {
      200: { description: "The imported plan with its days", content: json(s.TrainingPlanWithDays) },
      ...badRequest("VALIDATION_ERROR (ValidationErrorResponse) for a malformed body, or INVALID_CSV (ErrorResponse) when the CSV cannot be imported; the message names the row problem when there is one"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "post",
    path: "/api/v1/plans/sample",
    summary: "Create the built-in sample plan",
    description: "Creates the unscheduled 8-week template plan, keeping the goal and race date onboarding collected. The body is optional. Schedule it with POST /api/v1/plans/{planId}/schedule.",
    request: { body: { required: false, content: json(createSamplePlanSchema) } },
    responses: {
      200: { description: "The sample plan with its days", content: json(s.TrainingPlanWithDays) },
      ...common.validationError("Malformed body, or a raceDate that is not a real day or is in the past"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "post",
    path: "/api/v1/plans/generate",
    summary: "Start generating an AI training plan",
    description: "Asynchronous: creates a pending plan, queues the generation and answers 202 with the stub (days empty). Poll GET /api/v1/plans/{id}/generation-status until `ready` or `failed`, then GET the plan. Plans in supersedePlanIds are retired only once this one generates. A non-empty `injuries` is also saved to the athlete card.",
    request: { body: { required: true, content: json(generatePlanInputSchema) } },
    responses: {
      202: { description: "Generation started; the pending plan", content: json(s.TrainingPlanWithDays) },
      ...common.validationError(),
      ...aiConsent(),
      ...common.error(409, "PLAN_GENERATION_IN_PROGRESS: a generation is already running for this athlete"),
      ...common.authenticatedResponses(),
      ...aiBudget(),
    },
  });

  op({
    method: "get",
    path: "/api/v1/plans/{id}/generation-status",
    summary: "Poll an AI plan generation",
    request: { params: PlanParams },
    responses: {
      200: {
        description: "The plan's generation status",
        content: json(z.object({
          planId: z.string(),
          generationStatus: z.enum(GENERATION_STATUSES),
          error: d(z.string().optional(), "Present when the plan has a generation error: a client-safe message"),
        })),
      },
      ...notFound("plan"),
      ...common.authenticatedResponses(),
    },
  });

  const planUpdate = (path: string, summary: string, body: z.ZodType, description?: string) => ({
    method: "patch" as const,
    path,
    summary,
    description,
    request: { params: PlanParams, body: { required: true, content: json(body) } },
  });
  const planUpdateResponses = (): Responses => ({
    200: { description: "The updated plan", content: json(s.TrainingPlan) },
    ...common.validationError(),
    ...notFound("plan"),
  });

  op({
    ...planUpdate("/api/v1/plans/{id}", "Rename a training plan", renameTrainingPlanSchema),
    responses: { ...planUpdateResponses(), ...common.authenticatedResponses() },
  });

  op({
    ...planUpdate("/api/v1/plans/{id}/goal", "Set a training plan's goal", updateTrainingPlanGoalSchema),
    responses: { ...planUpdateResponses(), ...common.authenticatedResponses() },
  });

  op({
    ...planUpdate(
      "/api/v1/plans/{id}/retirement",
      "Archive or restore a training plan",
      updateTrainingPlanRetirementSchema,
      "A date archives the plan from that day on (dates before it still count); it is clamped forward to the athlete's today. `null` restores it, refused if another live plan covers the same dates.",
    ),
    responses: {
      ...planUpdateResponses(),
      ...common.error(409, "PLAN_OVERLAP: restoring would put two live plans over the same dates; the message names the other plan"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "delete",
    path: "/api/v1/plans/{id}",
    summary: "Delete a training plan",
    description: "Deletes the plan and its days into the recycle bin (restorable for 90 days). Workouts logged against it stay, unlinked.",
    request: { params: PlanParams },
    responses: {
      200: { description: "Deleted", content: json(RecycledResponse("plan")) },
      ...notFound("plan"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "post",
    path: "/api/v1/plans/{planId}/schedule",
    summary: "Schedule a training plan from a start date",
    description: "Dates every day from week 1, the Monday-anchored week containing startDate; nothing is placed before startDate (such days stay unscheduled). Days already completed, skipped or logged keep their dates.",
    request: { params: ScopedPlanParams, body: { required: true, content: json(schedulePlanRequestSchema) } },
    responses: {
      ...common.success("Scheduled"),
      ...badRequest("VALIDATION_ERROR (ValidationErrorResponse) for a malformed body, or NO_SESSIONS_AFTER_START (ErrorResponse) when none of the plan's sessions fall on or after startDate"),
      ...notFound("plan"),
      ...common.authenticatedResponses(),
    },
  });
}

// ---------------------------------------------------------------------------
// Plan days, recovery and the prescribed exercise table
// ---------------------------------------------------------------------------

function registerPlanDayRoutes({ op, common, notFound, badRequest }: Context, s: Schemas): void {
  const dayUpdated = (): Responses => ({ 200: { description: "The updated day", content: json(s.PlanDay) } });

  op({
    method: "patch",
    path: "/api/v1/plans/{planId}/days/{dayId}",
    summary: "Update a plan day (plan-scoped form)",
    description: "Writes the given fields as they are; a new scheduledDate is recorded as the athlete's move. Unlike PATCH /api/v1/plans/days/{dayId} it neither folds a missed session moved forward nor queues the coach, so prefer that route. Status goes through PATCH /api/v1/plans/days/{dayId}/status.",
    request: { params: PlanDayParams, body: { required: true, content: json(updatePlanDayRouteSchema) } },
    responses: { ...dayUpdated(), ...common.validationError(), ...notFound("plan day"), ...common.authenticatedResponses() },
  });

  op({
    method: "patch",
    path: "/api/v1/plans/days/{dayId}",
    summary: "Update a plan day",
    description: "Partial update of the athlete-editable fields (server-managed columns are ignored). Moving a missed session to today or later makes it planned again and records it as folded, undoable through recovery `reopen`. A date change queues an auto-coach pass. Status goes through PATCH /api/v1/plans/days/{dayId}/status.",
    request: { params: DayParams, body: { required: true, content: json(updatePlanDayRouteSchema) } },
    responses: { ...dayUpdated(), ...common.validationError(), ...notFound("plan day"), ...common.authenticatedResponses() },
  });

  op({
    method: "patch",
    path: "/api/v1/plans/days/{dayId}/status",
    summary: "Change a plan day's status or date",
    description: "With `status`, enforces the allowed transitions (skipped↔missed are refused); leaving `completed` folds the linked workout back onto the day and removes it. skipReason applies only to `skipped` and is cleared by any other status. Without `status`, a date-only move (a missed session moved forward is folded).",
    request: { params: DayParams, body: { required: true, content: json(patchDayStatusSchema) } },
    responses: {
      ...dayUpdated(),
      ...badRequest("VALIDATION_ERROR: a malformed body (ValidationErrorResponse), or a status transition that is not allowed (ErrorResponse)"),
      ...notFound("plan day"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "delete",
    path: "/api/v1/plans/days/{dayId}",
    summary: "Delete a plan day",
    description: "Deletes the day into the recycle bin (restorable for 90 days). A workout logged against it stays, unlinked.",
    request: { params: DayParams },
    responses: {
      200: { description: "Deleted", content: json(RecycledResponse("plan day")) },
      ...notFound("plan day"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "get",
    path: RECOVERY_PATH,
    summary: "Preview recovery options for a missed session",
    description: "What folding the missed session into another day, shortening it, or letting it go would do to the plan, with a recommendation.",
    request: { params: DayParams },
    responses: {
      200: { description: "The preview", content: json(s.PlanDayRecoveryPreview) },
      ...common.error(404, "NOT_FOUND: no such plan day, or it is unscheduled"),
      ...common.error(409, "CONFLICT: the session is not missed (or an absence excuses it), is a rest day, or falls on or after its plan's retirement"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "post",
    path: RECOVERY_PATH,
    summary: "Recover a missed session",
    description: "Carries out a choice from the preview: `fold` or `shorten` onto one of its target dates, `let_go`, or `reopen` to take the last decision back. Fold, shorten and undoing one queue an auto-coach pass.",
    request: { params: DayParams, body: { required: true, content: json(applyMissedRecoverySchema) } },
    responses: {
      200: { description: "The day after the change", content: json(z.object({ day: s.PlanDay })) },
      ...badRequest("VALIDATION_ERROR: a malformed body (ValidationErrorResponse), or a targetDate that is not one of the option's targets (ErrorResponse)"),
      ...common.error(404, "NOT_FOUND: no such plan day"),
      ...common.error(409, "CONFLICT: as for the preview; also an unavailable option, nothing to reopen, or the day changed while the athlete was deciding"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "get",
    path: "/api/v1/plans/days/{dayId}/sets",
    summary: "Get a plan day's exercise sets",
    description: "Without includeStructure: the day's prescribed exercise sets as an array. With includeStructure=true: an object with the sets and the structure blocks (sets missing for a structured day are derived first).",
    request: {
      params: DayParams,
      query: z.object({ includeStructure: d(z.boolean().optional(), "true to also return the structure blocks") }),
    },
    responses: {
      200: {
        description: "An array of sets, or PlanDaySetsAndStructure when includeStructure=true",
        content: json(z.union([z.array(s.PlanDayExerciseSet), s.PlanDaySetsAndStructure])),
      },
      ...notFound("plan day"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "post",
    path: "/api/v1/plans/days/{dayId}/sets",
    summary: "Add an exercise set to a plan day",
    description: "weightUnit/distanceUnit say which units the body's numbers are in; omitted, the athlete's current preference is assumed.",
    request: { params: DayParams, body: { required: true, content: json(addExerciseSetBodySchema) } },
    responses: {
      201: { description: "The created set", content: json(s.PlanDayExerciseSet) },
      ...common.validationError(),
      ...notFound("plan day"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "patch",
    path: "/api/v1/plans/days/{dayId}/sets/{setId}",
    summary: "Update an exercise set on a plan day",
    description: "Partial update. Send expectedVersion (the row's `version`) to have a concurrent edit refused with 409 instead of overwritten.",
    request: { params: DaySetParams, body: { required: true, content: json(patchExerciseSetBodySchema) } },
    responses: {
      200: { description: "The updated set", content: json(s.PlanDayExerciseSet) },
      ...common.validationError(),
      ...common.error(404, "NOT_FOUND: no such set on this athlete's plan day"),
      ...common.error(409, "CONFLICT: expectedVersion did not match; details carries currentVersion and expectedVersion"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "delete",
    path: "/api/v1/plans/days/{dayId}/sets/{setId}",
    summary: "Delete an exercise set from a plan day",
    request: { params: DaySetParams },
    responses: {
      ...common.success("Deleted"),
      ...common.error(404, "NOT_FOUND: no such set on this athlete's plan day"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "patch",
    path: "/api/v1/plans/days/{dayId}/set-order",
    summary: "Reorder a plan day's exercise sets",
    description: "Saves the whole order in one write: setIds must name every set on the day exactly once.",
    request: { params: DayParams, body: { required: true, content: json(exerciseSetOrderBodySchema) } },
    responses: {
      200: { description: "The day's sets in their new order", content: json(z.array(s.PlanDayExerciseSet)) },
      ...common.validationError(),
      ...notFound("plan day"),
      ...common.error(409, "CONFLICT: setIds does not name exactly the day's sets (the list changed since it was loaded)"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "patch",
    path: "/api/v1/plans/days/{dayId}/structure",
    summary: "Replace a plan day's structure blocks",
    description: "Replaces the day's blocks; relinks move the rows that follow renumbered steps in the same transaction. A body without structureBlocks clears them. Non-empty structureBlocks need the structured builder to be enabled on the server.",
    request: { params: DayParams, body: { required: true, content: json(planDayStructureBodySchema) } },
    responses: {
      200: { description: "The day's rows and blocks as saved", content: json(s.PlanDaySetsAndStructure) },
      ...badRequest("VALIDATION_ERROR: a malformed body (ValidationErrorResponse), or relinks sent without structureBlocks (ErrorResponse)"),
      ...common.error(403, "EMOM_BUILDER_DISABLED: the structured workout builder is not enabled"),
      ...common.error(404, "NOT_FOUND: no such plan day for this athlete, or a relinked set belongs elsewhere"),
      ...common.authenticatedResponses(),
    },
  });
}

// ---------------------------------------------------------------------------
// AI on a plan day
// ---------------------------------------------------------------------------

function registerPlanDayAiRoutes({ op, common, notFound, badRequest, aiConsent, aiBudget }: Context, s: Schemas): void {
  const reparseResponses = (): Responses => ({
    200: { description: "Parsed and saved", content: json(s.PlanDayReparseResponse) },
    ...aiConsent(),
    ...notFound("plan day"),
    ...common.error(422, "PARSE_WRITE_THROUGH_REQUIRED: the parse produced no exercise sets; nothing was changed"),
    ...common.error(500, "INTERNAL_ERROR: the parse failed for a reason other than the AI provider"),
    ...common.error(502, "AI_UPSTREAM_FAILURE or AI_ERROR: the AI provider failed or its reply could not be used"),
    ...common.authenticatedResponses(),
    ...aiBudget("; or AI_QUOTA_EXCEEDED: the AI provider's quota is exhausted"),
  });

  op({
    method: "post",
    path: "/api/v1/plans/days/{dayId}/reparse",
    summary: "Parse a plan day's text into exercise sets",
    description: "Parses mainWorkout + accessory with the AI and REPLACES the day's prescribed sets and structure blocks. Fields sent in the body are parsed instead of the stored text and saved to the day when the parse succeeds; send `{}` to parse the stored text.",
    request: { params: DayParams, body: { required: true, content: json(planDayReparseBodySchema) } },
    responses: {
      ...reparseResponses(),
      ...badRequest("VALIDATION_ERROR: a malformed body (ValidationErrorResponse), or AI_INVALID_INPUT: the AI provider rejected the request (ErrorResponse)"),
    },
  });

  op({
    method: "post",
    path: "/api/v1/plans/days/{dayId}/reparse-from-image",
    summary: "Parse a photo into a plan day's exercise sets",
    description: "Photo sibling of /reparse: the image (base64, at most 10 MB) is parsed with the AI and REPLACES the day's prescribed sets and structure blocks.",
    request: { params: DayParams, body: { required: true, content: json(parseExercisesFromImageRequestSchema) } },
    responses: {
      ...reparseResponses(),
      ...badRequest("VALIDATION_ERROR: a malformed body or an image that is not its declared type (ValidationErrorResponse), or AI_INVALID_INPUT: the AI provider rejected the request (ErrorResponse)"),
      ...common.error(413, "PAYLOAD_TOO_LARGE: the body is over 10 MB"),
    },
  });

  op({
    method: "post",
    path: "/api/v1/plans/days/{dayId}/coach-note/regenerate",
    summary: "Regenerate a plan day's coach note",
    description: "Rewrites the day's coach note (aiRationale) with the AI, e.g. after the athlete edited its exercises. At most once per 30 seconds per day.",
    request: { params: DayParams },
    responses: {
      200: {
        description: "The new note",
        content: json(z.object({ planDayId: z.string(), aiRationale: z.string(), aiNoteUpdatedAt: z.string().datetime() })),
      },
      ...aiConsent(),
      ...notFound("plan day"),
      ...common.error(502, "AI_ERROR or EXTERNAL_API_ERROR: the coach could not produce a note"),
      ...common.authenticatedResponses(),
      ...aiBudget(),
      429: {
        description: "RATE_LIMITED, AI_BUDGET_EXCEEDED (as on other AI routes), or COOLDOWN: the note was refreshed under 30 seconds ago; Retry-After and retryAfterMs say when to try again",
        content: json(
          AiLimitedResponse.extend({
            code: z.string().openapi({ description: "RATE_LIMITED, AI_BUDGET_EXCEEDED or COOLDOWN", example: "COOLDOWN" }),
            retryAfterMs: d(z.number().int().optional(), "COOLDOWN only: milliseconds until a refresh is allowed"),
          }),
        ),
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Plan proposals
// ---------------------------------------------------------------------------

function registerProposalRoutes({ op, common, notFound, aiConsent }: Context, s: Schemas): void {
  const tags = ["Plan proposals"];

  op({
    method: "get",
    path: "/api/v1/plan-proposals/pending",
    tags,
    summary: "Get the pending plan proposal",
    description: "The athlete's one pending proposal, if any.",
    responses: {
      200: { description: "The pending proposal, or null", content: json(z.object({ proposal: s.PlanProposal.nullable() })) },
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "get",
    path: "/api/v1/plan-proposals/{id}",
    tags,
    summary: "Get a plan proposal",
    description: "One proposal with its current status (it may have been applied or replaced since it was shown).",
    request: { params: ProposalParams },
    responses: {
      200: { description: "The proposal", content: json(z.object({ proposal: s.PlanProposal })) },
      ...notFound("proposal"),
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "post",
    path: "/api/v1/plan-proposals/{id}/apply",
    tags,
    summary: "Apply a plan proposal",
    description: "Applies every change, or only those for planDayIds (body optional). A refusal decided after the request was accepted (a structured re-parse failed, the AI budget is used up, AI is disabled) is a 200 with applied: false.",
    request: { params: ProposalParams, body: { required: false, content: json(applyPlanProposalRequestSchema) } },
    responses: {
      200: {
        description: "Applied, or applied: false with a reason and message",
        content: json(
          z.object({
            applied: z.boolean(),
            changeCount: d(z.number().int().optional(), "When applied: the changes written"),
            reason: z.enum(["structured_parse_failed", "ai_budget_exceeded", "ai_disabled"]).optional(),
            message: d(z.string().optional(), "When not applied: copy for the athlete"),
          }),
        ),
      },
      400: {
        description: "VALIDATION_ERROR for a malformed body (ValidationErrorResponse), or reason invalid_selection: planDayIds names a day the proposal does not change (PlanProposalApplyFailure)",
        content: {
          "application/json": { schema: { oneOf: [ref("ValidationErrorResponse"), ref("PlanProposalApplyFailure")] } },
        },
      },
      ...aiConsent(),
      ...notFound("proposal"),
      409: {
        description: "not_pending: already applied, dismissed or replaced; stale: its days changed since it was made (the proposal is invalidated)",
        content: json(s.PlanProposalApplyFailure),
      },
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "post",
    path: "/api/v1/plan-proposals/{id}/undo",
    tags,
    summary: "Undo an applied plan proposal",
    description: "Within 7 days of the apply, puts each changed day back, except what the athlete has changed since (listed in keptDays).",
    request: { params: ProposalParams },
    responses: {
      200: {
        description: "Undone",
        content: json(
          z.object({
            undone: z.literal(true),
            restoredCount: d(z.number().int(), "Days put back, wholly or in part"),
            keptDays: d(z.array(DayLabel), "Days changed since the apply, left as they are"),
          }),
        ),
      },
      ...notFound("proposal"),
      409: {
        description: "Nothing was undone",
        content: json(
          z.object({
            undone: z.literal(false),
            reason: z.enum(["not_applied", "not_undoable", "expired", "changed_since"]),
            message: z.string(),
          }),
        ),
      },
      ...common.authenticatedResponses(),
    },
  });

  op({
    method: "post",
    path: "/api/v1/plan-proposals/{id}/dismiss",
    tags,
    summary: "Dismiss a plan proposal",
    request: { params: ProposalParams },
    responses: {
      200: { description: "dismissed is false when the proposal was no longer pending", content: json(z.object({ dismissed: z.boolean() })) },
      ...notFound("proposal"),
      ...common.authenticatedResponses(),
    },
  });
}
