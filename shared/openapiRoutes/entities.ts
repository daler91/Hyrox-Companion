import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { createSelectSchema } from "drizzle-zod";

import type { ParsedExercise as ParsedExerciseType } from "../schema";
import {
  coachNoteInputsSchema,
  enrichedPlanAdjustmentChangeSchema,
  exerciseSets,
  formatTypeSchema,
  planProposalStatusSchema,
  sectionTypeSchema,
  structureBlockScoreSchema,
  structureStepTypeSchema,
} from "../schema";
import { z } from "../schema/zod";

/**
 * Entities several areas return: a stored exercise set, a stored structure
 * block, an AI-parsed exercise, the coach-note inputs and a plan proposal.
 * Registered once here and handed to the area modules, so the document has
 * one component (and the app one generated class) per entity, not one per
 * route family that happens to return it.
 */
export interface EntityComponents {
  readonly ExerciseSetRow: z.ZodObject;
  readonly WorkoutStructureBlock: z.ZodObject;
  readonly ParsedExercise: z.ZodObject;
  readonly CoachNoteInputs: z.ZodType;
  readonly PlanProposal: z.ZodObject;
}

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

/** A JSON object column (jsonb) the API passes through as written. */
const jsonObject = () => z.record(z.string(), z.unknown());
const int = () => z.number().int();

/** A stored exercise_sets row: a plan day's prescription or a logged workout's sets. */
const exerciseSetRowSchema = createSelectSchema(exerciseSets)
  .extend({
    time: z.number().nullable().openapi({ description: "MINUTES (fractional: 45 s is 0.75)" }),
    plannedTime: z.number().nullable().openapi({ description: "Minutes" }),
    weightUnit: z.string().max(8).nullable().openapi({
      description:
        'The unit `weight` and `plannedWeight` are stored in, "kg" or "lbs". Null on legacy rows, whose values are in the athlete\'s current weight unit.',
    }),
    distanceUnit: z.string().max(8).nullable().openapi({
      description:
        'The unit `distance` and `plannedDistance` are stored in, "m" or "ft". Null on legacy rows, whose values are in the athlete\'s current distance unit.',
    }),
    // Enforced by a CHECK constraint, so it is a closed set.
    repMode: z.enum(["total", "per_side"]).nullable(),
    intensity: jsonObject().nullable(),
    load: jsonObject().nullable(),
    tempo: jsonObject().nullable(),
    standards: jsonObject().nullable(),
    version: int().openapi({
      description:
        "Optimistic-lock version, bumped on every update. Send it back as `expectedVersion` on PATCH to get a 409 instead of overwriting another device's edit.",
    }),
  })
  .openapi({
    description: "A stored exercise set row. Exactly one of workoutLogId (logged) and planDayId (prescribed) is set.",
  });

/**
 * A stored structure block as storage maps it (mapStructureBlockRows in
 * server/storage/workouts.ts): what workout detail, plan days and timeline
 * entries all return.
 */
const workoutStructureBlockSchema = z
  .object({
    id: z.string(),
    sectionType: sectionTypeSchema,
    formatType: formatTypeSchema,
    durationSeconds: int().nullable(),
    rounds: int().nullable(),
    workSeconds: int().nullable(),
    restSeconds: int().nullable(),
    durationMinutes: int().nullable(),
    roundCount: int().nullable(),
    timeCapMinutes: int().nullable(),
    workIntervalSec: int().nullable(),
    restIntervalSec: int().nullable(),
    instructions: z.string().nullable(),
    score: structureBlockScoreSchema.nullable().openapi({
      description: "The athlete's result for an emom, amrap or rounds block; its type matches formatType",
    }),
    sequenceOrder: int(),
    sortOrder: int(),
    steps: z.array(
      z.object({
        stepNumber: int(),
        minuteIndex: int().nullable(),
        stepType: structureStepTypeSchema,
        exerciseName: z.string().nullable(),
        category: z.string().nullable(),
        customLabel: z.string().nullable(),
        stepRole: z.string().nullable(),
        intensity: jsonObject().nullable(),
        loadMode: z.string().nullable(),
        unilateralMode: z.string().nullable(),
        tempo: jsonObject().nullable(),
        constraintTags: z.array(z.string()).nullable(),
        groupId: z.string().nullable(),
        groupMeta: jsonObject().nullable(),
        targets: jsonObject().nullable().openapi({
          description: "targetReps / targetTime (minutes) / targetDistance / targetWeight and any other targets",
        }),
      }),
    ),
  })
  .openapi({ description: "A stored structure block (EMOM, AMRAP, rounds...) with its steps" });

// The optional fields a parsed exercise and each of its sets share (ParsedExercise in shared/schema).
const parsedSetFields = {
  reps: int().optional(),
  weight: z.number().optional().openapi({ description: "In the athlete's weight unit" }),
  distance: z.number().optional().openapi({ description: "In the athlete's stored distance unit (m, or ft for miles)" }),
  time: z.number().optional().openapi({ description: "Minutes" }),
  plannedReps: int().optional(),
  plannedWeight: z.number().optional(),
  plannedDistance: z.number().optional(),
  plannedTime: z.number().optional(),
  notes: z.string().optional(),
  blockId: z.string().optional(),
  stepNumber: int().optional(),
  intervalMinute: int().optional(),
  cycleNumber: int().optional(),
  stepRole: z.string().optional(),
  groupId: z.string().optional(),
  intensity: jsonObject().optional(),
  load: jsonObject().optional(),
  repMode: z.enum(["total", "per_side"]).optional(),
  tempo: jsonObject().optional(),
  standards: jsonObject().optional(),
};

const parsedExerciseSchema = z
  .object({
    exerciseName: z.string().openapi({
      description: 'A canonical exercise key such as "sled_push", or "custom" with the name in customLabel',
    }),
    category: z.string(),
    customLabel: z.string().optional(),
    confidence: int().min(0).max(100).optional(),
    missingFields: z.array(z.string()).optional().openapi({
      description: "What the parser could not read; on the first row, also structure warnings",
    }),
    numSets: z.number().optional(),
    ...parsedSetFields,
    sets: z.array(z.object({ setNumber: int(), ...parsedSetFields })),
  })
  .openapi({ description: "One exercise the AI parser read, with its sets" });
// Compile-time guard: the document's shape and the shared TS type cannot drift apart.
type _ParsedExerciseMatches = Assert<Same<z.infer<typeof parsedExerciseSchema>, ParsedExerciseType>>;

/** serializePlanProposal in server/routes/planProposals.ts; also streamed by the coach chat. */
const planProposalSchema = z
  .object({
    id: z.string(),
    planId: z.string().openapi({ description: "The plan of the first change" }),
    status: planProposalStatusSchema,
    summaryMessage: z.string().openapi({ description: "The coach's summary of the proposal" }),
    changes: z.array(enrichedPlanAdjustmentChangeSchema).openapi({
      description: "One change per plan day, with the day as it stood when proposed (baseline)",
    }),
    createdAt: z.string().datetime(),
    appliedPlanDayIds: z.array(z.string()).optional().openapi({
      description: "Applied or reverted proposals only: the plan days the apply changed",
    }),
    undoable: z.boolean().optional().openapi({
      description: "Applied proposals only: whether POST /api/v1/plan-proposals/{id}/undo can still take it back (7 days)",
    }),
  })
  .openapi({ description: "A multi-day plan change the AI coach proposed from a chat message, with its current status" });

export function registerEntityComponents(registry: OpenAPIRegistry): EntityComponents {
  return {
    ExerciseSetRow: registry.register("ExerciseSetRow", exerciseSetRowSchema),
    WorkoutStructureBlock: registry.register("WorkoutStructureBlock", workoutStructureBlockSchema),
    ParsedExercise: registry.register("ParsedExercise", parsedExerciseSchema),
    CoachNoteInputs: registry.register(
      "CoachNoteInputs",
      coachNoteInputsSchema.openapi({ description: "Which inputs drove the coach's note on a plan day, shown with the note" }),
    ),
    PlanProposal: registry.register("PlanProposal", planProposalSchema),
  };
}
