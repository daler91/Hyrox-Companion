import type { OpenAPIRegistry, ResponseConfig } from "@asteasolutions/zod-to-openapi";
import { createSelectSchema } from "drizzle-zod";

import type { SessionGrade } from "../schema";
import {
  addExerciseSetBodySchema,
  customExercises,
  exerciseSetOrderBodySchema,
  mafTestResults,
  mafWorkoutAnalysis,
  parseExercisesFromImageRequestSchema,
  parseExercisesRequestSchema,
  patchExerciseSetBodySchema,
  sessionStreamStatusEnum,
  structureBlockSchema,
  structuredExerciseBackfillReviews,
} from "../schema";
import {
  assignWorkoutPlanDaySchema,
  bulkDeleteWorkoutsSchema,
  combineWorkoutsSchema,
  createCustomExerciseSchema,
  exerciseHistoryQuerySchema,
  linkDeviceActivitySchema,
  mafTestBodySchema,
  migrationReviewResolveSchema,
  migrationReviewsQuerySchema,
  reparseWorkoutRouteSchema,
  updateBlockScoreBodySchema,
} from "../schema/types/workoutsRequests";
import { z } from "../schema/zod";
import type { OpenApiCommon } from "./common";
import type { EntityComponents } from "./entities";

/** Components this module takes from shared/openapi.ts rather than registering again. */
export interface WorkoutsPathSchemas {
  /** The registered `WorkoutLog` component: a stored workout_logs row. */
  readonly WorkoutLog: z.ZodObject;
  /** The registered `WorkoutId` path parameter (`id`). */
  readonly WorkoutId: z.ZodType<string>;
  /**
   * The same shapes, when another module has registered them (the session
   * grades list, the MAF history). Without them this module registers
   * `WorkoutSessionGrade` and describes the MAF rows inline.
   */
  readonly SessionGrade?: z.ZodType;
  readonly MafTestResult?: z.ZodType;
  readonly MafWorkoutAnalysis?: z.ZodType;
  /** Shared entities (shared/openapiRoutes/entities.ts): set rows, structure blocks, parsed exercises. */
  readonly entities: EntityComponents;
}

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type Responses = Record<number, ResponseConfig>;

const json = (schema: z.ZodType) => ({ "application/json": { schema } });
const ok = (description: string, schema: z.ZodType, status = 200): Responses => ({
  [status]: { description, content: json(schema) },
});

/** A JSON object column (jsonb) the API passes through as written. */
const jsonObject = () => z.record(z.string(), z.unknown());
const int = () => z.number().int();

// ---------------------------------------------------------------------------
// Response shapes (plain Zod; registered as components below where reused)
// ---------------------------------------------------------------------------

const nullableNumbers = <K extends string>(...keys: K[]) =>
  Object.fromEntries(keys.map((key) => [key, z.number().nullable()])) as Record<K, z.ZodNullable<z.ZodNumber>>;

const sessionGradeSchema = z
  .object({
    workoutLogId: z.string(),
    planDayId: z.string(),
    planId: z.string().nullable(),
    date: z.string(),
    weekNumber: int().nullable(),
    title: z.string().openapi({ description: 'The plan day\'s title, e.g. "Threshold Run"' }),
    intent: z.enum(["easy", "threshold"]),
    purpose: z.enum(["easy", "recovery", "long", "threshold", "intervals", "steady", "race"]),
    intentReason: z.string().nullable(),
    verdict: z.enum(["on_target", "crept_up", "too_hard", "drifted_harder", "under", "inconclusive", "ungradeable"]),
    headline: z.string(),
    evidence: z.array(z.string()).openapi({ description: "One to three sentences backing the verdict" }),
    confidence: z.enum(["high", "medium", "low"]).nullable(),
    dataSource: z.enum(["stream", "summary"]).nullable(),
    streamStatus: z.enum([...sessionStreamStatusEnum, "pending", "not_applicable"]),
    ungradeableReason: z.enum(["no_targets", "no_data", "too_short"]).nullable(),
    targets: z.object({
      easyCeilingHr: z.number().nullable(),
      thresholdHr: z.object({ min: z.number(), max: z.number() }).nullable(),
      z5FloorHr: z.number().nullable(),
      hrBasis: z.enum(["measured", "age_estimated", "maf"]).nullable(),
      easyPace: z.object({ fast: z.number(), slow: z.number() }).nullable().openapi({ description: "Seconds per km" }),
      thresholdPace: z.number().nullable().openapi({ description: "Seconds per km" }),
      paceSource: z.enum(["plan", "engine", "history"]).nullable(),
    }),
    easy: z
      .object({
        movingMinutes: z.number(),
        ...nullableNumbers("avgHr", "pctAboveCeiling", "firstThirdHr", "lastThirdHr", "hrDriftPct"),
        ...nullableNumbers("avgPaceSecPerKm", "pctFasterThanEasy", "excludedFinishMinutes"),
      })
      .nullable(),
    threshold: z
      .object({
        segmentation: z.enum(["reps", "continuous", "whole_run"]),
        workMinutes: z.number(),
        repCount: int(),
        ...nullableNumbers("workAvgPaceSecPerKm", "paceDeltaPct", "workAvgHr", "pctWorkZ4", "pctWorkZ5"),
        ...nullableNumbers("firstRepHr", "lastRepHr", "decouplingPct"),
      })
      .nullable(),
    countsInRollup: z.boolean(),
  })
  .openapi({ description: '"Did the session do its job?" for one plan-linked run, computed when read' });
type _SessionGradeMatches = Assert<Same<z.infer<typeof sessionGradeSchema>, SessionGrade>>;

const mafTestResultSchema = createSelectSchema(mafTestResults).extend({
  conditions: jsonObject().nullable().openapi({
    description: 'For a tagged workout: { source: "tagged_workout", workoutLogId }',
  }),
  metrics: z
    .object({ ...nullableNumbers("durationSeconds", "distanceMeters", "avgHeartRate", "maxHeartRate"), mafCeilingUsed: z.number() })
    .nullable(),
});

const mafWorkoutAnalysisSchema = createSelectSchema(mafWorkoutAnalysis).extend({
  classification: z.enum(["compliant", "mostly_compliant", "over_ceiling"]).nullable(),
  analysisDetails: z
    .object({ avgHeartRate: z.number(), ceiling: z.number(), avgOverBy: z.number(), ...nullableNumbers("maxHeartRate", "maxOverBy") })
    .nullable(),
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

function registerComponents(registry: OpenAPIRegistry, schemas: WorkoutsPathSchemas) {
  const { ExerciseSetRow, WorkoutStructureBlock, ParsedExercise } = schemas.entities;
  const parsedFields = { exercises: z.array(ParsedExercise) };
  const MafAnalysis = schemas.MafWorkoutAnalysis ?? mafWorkoutAnalysisSchema;
  return {
    ExerciseSetRow,
    CustomExercise: registry.register(
      "CustomExercise",
      createSelectSchema(customExercises).openapi({ description: "An exercise the athlete named themselves" }),
    ),
    WorkoutStructureBlock,
    ParsedExercise,
    ParseWorkoutStructureResponse: registry.register(
      "ParseWorkoutStructureResponse",
      z.object({
        ...parsedFields,
        structureBlocks: z.array(
          registry.register(
            "ParsedStructureBlock",
            structureBlockSchema.openapi({ description: "A structure block the AI parser read. Nothing is saved." }),
          ),
        ),
        warnings: z.array(z.string()),
        confidence: z
          .object({
            exerciseMapping: z.number().min(0).max(100).nullable().optional(),
            structureQuality: z.number().min(0).max(100).nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    ),
    WorkoutReparseResponse: registry.register(
      "WorkoutReparseResponse",
      z.object({
        ...parsedFields,
        saved: z.literal(true),
        setCount: int().openapi({ description: "Exercise sets now stored on the workout" }),
        rejectedCount: int().openapi({ description: "Parsed rows dropped as malformed" }),
        rejectionReasons: z.array(z.string()),
      }),
    ),
    // The AI guards' 429 carries the spend figures on top of the usual envelope.
    ParseRateLimitResponse: registry.register(
      "ParseRateLimitResponse",
      z.object({
        error: z.string(),
        code: z.enum(["RATE_LIMITED", "AI_BUDGET_EXCEEDED"]),
        currentCostCents: int().optional().openapi({ description: "AI_BUDGET_EXCEEDED only" }),
        limitCents: int().optional().openapi({ description: "AI_BUDGET_EXCEEDED only" }),
      }),
    ),
    SessionGrade: schemas.SessionGrade ?? registry.register("WorkoutSessionGrade", sessionGradeSchema),
    MafTestRecord: z.object({
      testResult: schemas.MafTestResult ?? mafTestResultSchema,
      analysis: MafAnalysis.nullable().openapi({
        description: "The compliance analysis; null when there is no average heart rate",
      }),
    }),
  };
}

interface Ctx {
  readonly registry: OpenAPIRegistry;
  readonly common: OpenApiCommon;
  readonly c: ReturnType<typeof registerComponents>;
  readonly WorkoutLog: z.ZodObject;
  readonly WorkoutId: z.ZodType<string>;
  readonly workoutParams: z.ZodObject<{ id: z.ZodType<string> }>;
  readonly workoutNotFound: () => Responses;
}

/**
 * Everything about workouts beyond create/read/update/delete of the log itself
 * (registered in shared/openapi.ts): set-level edits, structure scores, device
 * links, MAF tags, history, AI parsing and reparse, combine and bulk delete,
 * custom exercises, the data export and the assisted-migration reviews.
 */
export function registerWorkoutsPaths(
  registry: OpenAPIRegistry,
  common: OpenApiCommon,
  schemas: WorkoutsPathSchemas,
): void {
  const ctx: Ctx = {
    registry,
    common,
    c: registerComponents(registry, schemas),
    WorkoutLog: schemas.WorkoutLog,
    WorkoutId: schemas.WorkoutId,
    workoutParams: z.object({ id: schemas.WorkoutId }),
    workoutNotFound: () => common.error(404, "NOT_FOUND: no such workout for this user"),
  };
  registerSetPaths(ctx);
  registerReadPaths(ctx);
  registerLinkPaths(ctx);
  registerGradeAndMafPaths(ctx);
  registerAiPaths(ctx);
  registerExerciseAndExportPaths(ctx);
}

/** Exercise sets on a logged workout, and the result of a structure block. */
function registerSetPaths({ registry, common, c, WorkoutId, workoutParams, workoutNotFound }: Ctx): void {
  const security = common.security;
  const setParams = z.object({ id: WorkoutId, setId: z.string().openapi({ description: "The exercise set id" }) });

  registry.registerPath({
    method: "post", path: "/api/v1/workouts/{id}/sets", tags: ["Exercises"],
    summary: "Add an exercise set to a workout",
    description: "Appends a set at the end of the workout's order. `weightUnit` / `distanceUnit` name the units the numbers were typed in (else the athlete's current preference); the row is stamped with them. Prescription (planned*) fields cannot be set here.",
    security,
    request: { params: workoutParams, body: { required: true, content: json(addExerciseSetBodySchema) } },
    responses: {
      ...ok("The created set", c.ExerciseSetRow, 201), ...common.validationError(), ...workoutNotFound(),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "patch", path: "/api/v1/workouts/{id}/sets/{setId}", tags: ["Exercises"],
    summary: "Update an exercise set",
    description: "Patches the fields sent. blockId and stepNumber must be sent together. Send `expectedVersion` (the row's `version`) to have a concurrent edit from another device refused with 409 instead of overwritten.",
    security,
    request: { params: setParams, body: { required: true, content: json(patchExerciseSetBodySchema) } },
    responses: {
      ...ok("The updated set", c.ExerciseSetRow), ...common.validationError(),
      ...common.error(404, "NOT_FOUND: no such set on this workout for this user"),
      ...common.error(409, "CONFLICT: expectedVersion is stale; details carries currentVersion and expectedVersion. Reload the set and retry."),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "delete", path: "/api/v1/workouts/{id}/sets/{setId}", tags: ["Exercises"],
    summary: "Delete an exercise set",
    description: "Also succeeds when the set no longer exists.",
    security,
    request: { params: setParams },
    responses: {
      ...common.success("Deleted"), ...common.error(404, "NOT_FOUND: the set belongs to another workout"),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "patch", path: "/api/v1/workouts/{id}/set-order", tags: ["Exercises"],
    summary: "Reorder a workout's exercise sets",
    description: "Saves the whole order in one write: each set's sortOrder becomes its index in `setIds`, which must name every set on the workout exactly once. Versions are not bumped.",
    security,
    request: { params: workoutParams, body: { required: true, content: json(exerciseSetOrderBodySchema) } },
    responses: {
      ...ok("The workout's sets in their new order", z.array(c.ExerciseSetRow)), ...common.validationError(),
      ...workoutNotFound(),
      ...common.error(409, "CONFLICT: setIds does not match the sets stored now (another device added or removed one)"),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "post", path: "/api/v1/workouts/{id}/seed-from-plan", tags: ["Exercises"],
    summary: "Copy the linked plan day's sets into a workout",
    description: "For a plan-linked workout with no sets of its own: copies the plan day's prescribed sets in as starter rows. Does nothing (seededCount 0) when the workout already has sets, has no plan day, or is not the caller's.",
    security,
    request: { params: workoutParams },
    responses: {
      ...ok("How many sets were copied", z.object({ seededCount: int() })), ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "patch", path: "/api/v1/workouts/{id}/structure-blocks/{blockId}/score", tags: ["Workouts"],
    summary: "Record the result of a structure block",
    description: "Sets or clears (null) an emom, amrap or rounds block's score. The score's type must match the block's format.",
    security,
    request: {
      params: z.object({ id: WorkoutId, blockId: z.string().openapi({ description: "The structure block id" }) }),
      body: { required: true, content: json(updateBlockScoreBodySchema) },
    },
    responses: {
      ...ok(
        "All of the workout's structure blocks after the change",
        z.object({ structureBlocks: z.array(c.WorkoutStructureBlock) }),
      ),
      ...common.validationError("The body failed validation; or (ErrorResponse, VALIDATION_ERROR) the score type does not match the block format"),
      ...common.error(404, "NOT_FOUND: no such block on this workout for this user"),
      ...common.authenticatedResponses(),
    },
  });
}

function registerReadPaths({ registry, common, c, WorkoutLog, workoutParams, workoutNotFound }: Ctx): void {
  const security = common.security;

  registry.registerPath({
    method: "get", path: "/api/v1/workouts/latest", tags: ["Workouts"],
    summary: "Get the most recent workout",
    security,
    responses: {
      ...ok(
        "The latest workout log with its exercise sets and structure blocks",
        // Registered under its own name: an inline extension would inherit WorkoutLog's title.
        registry.register(
          "WorkoutLatest",
          WorkoutLog.extend({
            exerciseSets: z.array(c.ExerciseSetRow),
            structureBlocks: z.array(c.WorkoutStructureBlock),
          }).openapi({ title: "WorkoutLatest", description: "A workout log with its exercise sets and structure blocks" }),
        ),
      ),
      ...common.error(404, "NOT_FOUND: the athlete has no workouts"), ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "get", path: "/api/v1/workouts/unstructured", tags: ["Workouts"],
    summary: "List workouts with text but no exercise sets",
    description: "The candidates for AI reparse. Logs a Strava auto link created are left out: their text is the plan's prescription, not what was done.",
    security,
    responses: { ...ok("Workout logs", z.array(WorkoutLog)), ...common.authenticatedResponses() },
  });

  registry.registerPath({
    method: "get", path: "/api/v1/workouts/{id}/history", tags: ["Workouts"],
    summary: "Get a workout's history stats",
    security,
    request: { params: workoutParams },
    responses: {
      ...ok(
        "Computed when read",
        z.object({
          lastSameFocus: z
            .object({ date: z.string(), focus: z.string() })
            .nullable()
            .openapi({ description: "The athlete's previous workout with the same focus" }),
          prSetCount: int().openapi({ description: "Sets in this workout heavier than the athlete's best before it" }),
          blockAvgRpe: z
            .number()
            .nullable()
            .openapi({ description: "Average RPE over the 28 days up to this workout, one decimal" }),
        }),
      ),
      ...workoutNotFound(), ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "get", path: "/api/v1/exercises/{exerciseName}/history", tags: ["Exercises"],
    summary: "Get past logged sets of one exercise",
    description: 'Newest session first. The name is resolved to its canonical key, so "RDL" finds romanian_deadlift; an unknown name matches exactly (custom exercises).',
    security,
    request: {
      params: z.object({
        exerciseName: z.string().openapi({ description: "Exercise name or key", example: "sled_push" }),
      }),
      query: exerciseHistoryQuerySchema,
    },
    responses: {
      ...ok(
        "Logged sets with their workout's date",
        z.array(
          c.ExerciseSetRow.extend({
            date: z.string().openapi({ description: "The parent workout's date, YYYY-MM-DD" }),
            timeOfDayMin: int()
              .nullable()
              .openapi({ description: "The parent workout's start, minutes from local midnight" }),
          }).openapi({ description: "A logged exercise set with its workout's date" }),
        ),
      ),
      ...common.validationError(), ...common.authenticatedResponses(),
    },
  });
}

/** Plan linkage, device links, combine and bulk delete. */
function registerLinkPaths({ registry, common, WorkoutLog, workoutParams, workoutNotFound }: Ctx): void {
  const security = common.security;

  registry.registerPath({
    method: "patch", path: "/api/v1/workouts/{id}/plan-day", tags: ["Workouts"],
    summary: "Link a workout to a plan day, or unlink it",
    description: "planDayId null unlinks. Recomputes the workout's adherence columns and the plan days' statuses.",
    security,
    request: { params: workoutParams, body: { required: true, content: json(assignWorkoutPlanDaySchema) } },
    responses: {
      ...ok("The updated workout log", WorkoutLog), ...common.validationError(),
      ...common.error(404, "NOT_FOUND: no such workout, or plan day, for this user"),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "post", path: "/api/v1/workouts/{id}/device-link", tags: ["Workouts"],
    summary: "Link a standalone Strava import to a plan day or workout",
    description: "{id} is the standalone Strava log. Its recording moves onto the target (a plan day without a log gets one) and the standalone row is deleted.",
    security,
    request: { params: workoutParams, body: { required: true, content: json(linkDeviceActivitySchema) } },
    responses: {
      ...ok("The log that now carries the recording", WorkoutLog),
      ...common.validationError("The body failed validation; or (ErrorResponse, BAD_REQUEST) the target is the import itself"),
      ...common.error(404, "NOT_FOUND: no such workout or plan day for this user"),
      ...common.error(409, "CONFLICT: {id} is not a standalone Strava import, or the target already has a device activity"),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "delete", path: "/api/v1/workouts/{id}/device-link", tags: ["Workouts"],
    summary: "Unlink a workout's Strava activity",
    description: "Takes the recording off workout {id} and gives it its own standalone row again. A log the link created and the athlete never edited is deleted (log is then null).",
    security,
    request: { params: workoutParams },
    responses: {
      ...ok(
        "What remains of the workout, and the recording's standalone log",
        z.object({
          log: WorkoutLog.nullable().openapi({ description: "Null when the link had created the log" }),
          standalone: WorkoutLog,
        }),
      ),
      ...workoutNotFound(), ...common.error(409, "CONFLICT: the workout has no linked Strava activity"),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "delete", path: "/api/v1/workouts/{id}/device-link/suggestion", tags: ["Workouts"],
    summary: "Dismiss the suggested match for a Strava import",
    description: '"Not this one": clears the suggested plan day or workout. Idempotent.',
    security,
    request: { params: workoutParams },
    responses: { ...ok("The updated log", WorkoutLog), ...workoutNotFound(), ...common.authenticatedResponses() },
  });

  registry.registerPath({
    method: "post", path: "/api/v1/workouts/combine", tags: ["Workouts"],
    summary: "Combine workouts into one",
    description: "Creates newWorkout, moves the sources' exercise sets onto it, deletes the sources and marks skipPlanDayIds as skipped, in one transaction. Every source linked to a plan day must be on the kept day (newWorkout.planDayId) or in skipPlanDayIds.",
    security,
    request: { body: { required: true, content: json(combineWorkoutsSchema) } },
    responses: {
      ...ok("The combined workout log", WorkoutLog, 201),
      ...common.validationError("The body failed validation; or (ErrorResponse, VALIDATION_ERROR) a source is linked to a plan day that is neither kept nor skipped"),
      ...common.error(404, "NOT_FOUND: a source workout or the kept plan day is not the caller's"),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "post", path: "/api/v1/workouts/bulk-delete", tags: ["Workouts"],
    summary: "Delete several workouts and plan days",
    description: "All or nothing. Everything deleted goes to the recycle bin under one batchId, so a single restore undoes the whole delete.",
    security,
    request: { body: { required: true, content: json(bulkDeleteWorkoutsSchema) } },
    responses: {
      ...ok(
        "Deleted",
        z.object({
          success: z.literal(true),
          deletedWorkoutLogIds: z.array(z.string()),
          deletedPlanDayIds: z.array(z.string()),
          deletedCount: int(),
          batchId: z.string(),
          recycleBinItemIds: z.array(z.string()),
        }),
      ),
      ...common.validationError(),
      ...common.error(404, "NOT_FOUND: one or more ids are not the caller's; nothing was deleted"),
      ...common.authenticatedResponses(),
    },
  });
}

function registerGradeAndMafPaths({ registry, common, c, workoutParams, workoutNotFound }: Ctx): void {
  const security = common.security;
  const mafSetupRequired =
    "The body failed validation; or (ErrorResponse, VALIDATION_ERROR) the athlete is not on the MAF Method training style with a heart-rate ceiling";
  const notTagged = () => common.error(404, "NOT_FOUND: the workout is not tagged as a MAF test");

  registry.registerPath({
    method: "get", path: "/api/v1/workouts/{id}/session-grade", tags: ["Workouts"],
    summary: "Get a workout's session grade",
    description: "grade is null for anything not graded: not plan-linked, not a run, or a session kind with no grader. A grade with streamStatus pending is refined once the Strava stream arrives; poll again later.",
    security,
    request: { params: workoutParams },
    responses: {
      ...ok("The grade, or null", z.object({ grade: c.SessionGrade.nullable() })), ...workoutNotFound(),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "post", path: "/api/v1/workouts/{id}/maf-test", tags: ["Workouts"],
    summary: "Tag a workout as a MAF test",
    description: "Records a MAF test from the run's metrics (overridden by any metrics sent) and, with an average heart rate, a compliance analysis against the athlete's current ceiling. Tagging an already-tagged workout returns the existing record unchanged; corrections go through PATCH.",
    security,
    request: { params: workoutParams, body: { required: true, content: json(mafTestBodySchema) } },
    responses: {
      ...ok("Tagged", c.MafTestRecord, 201), ...ok("Already tagged: the existing record", c.MafTestRecord),
      ...common.validationError(mafSetupRequired), ...common.error(404, "NOT_FOUND: no such workout (or user)"),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "patch", path: "/api/v1/workouts/{id}/maf-test", tags: ["Workouts"],
    summary: "Correct a workout's MAF test",
    description: "Applies manual metric corrections (an omitted metric keeps its value, null clears it) and recomputes the analysis against the athlete's current ceiling.",
    security,
    request: { params: workoutParams, body: { required: true, content: json(mafTestBodySchema) } },
    responses: {
      ...ok("The updated record", c.MafTestRecord), ...common.validationError(mafSetupRequired), ...notTagged(),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "delete", path: "/api/v1/workouts/{id}/maf-test", tags: ["Workouts"],
    summary: "Untag a workout as a MAF test",
    description: "Removes the MAF test and its analysis.",
    security,
    request: { params: workoutParams },
    responses: { ...common.success("Untagged"), ...notTagged(), ...common.authenticatedResponses() },
  });
}

/** AI parsing (stateless) and reparse (writes the workout's sets). */
function registerAiPaths({ registry, common, c, workoutParams, workoutNotFound }: Ctx): void {
  const security = common.security;
  const headers = {
    "X-AI-Budget-Warning": {
      description: '"true" when the athlete has used most of their rolling 24-hour AI budget',
      schema: { type: "string" as const },
    },
    "X-AI-Budget-Remaining-Cents": {
      description: "Budget left, in cents; sent with X-AI-Budget-Warning",
      schema: { type: "string" as const },
    },
  };
  /** 200 for an AI route: the body plus the budget warning headers. */
  const aiOk = (description: string, schema: z.ZodType): Responses => ({
    200: { description, headers, content: json(schema) },
  });
  /**
   * What the route's own failures and the AI consent and budget middleware
   * answer with. Spread after authenticatedResponses(): its 429 replaces the
   * plain rate-limit one.
   */
  const aiErrors = (): Responses => ({
    ...common.error(502, "AI_ERROR or EXTERNAL_API_ERROR: the AI provider failed or returned nothing usable"),
    ...common.error(403, "AI_COACH_DISABLED: AI processing is off for this account; it is enabled in Settings"),
    429: {
      description: "RATE_LIMITED (Retry-After says when to try again), or AI_BUDGET_EXCEEDED: the athlete's rolling 24-hour AI spend is used up",
      content: json(c.ParseRateLimitResponse),
    },
    ...common.error(503, "AI_FEATURES_DISABLED (switched off by the operator), AI_GLOBAL_BUDGET_EXCEEDED (app-wide daily cap reached) or AI_BUDGET_UNAVAILABLE (the budget check failed)"),
  });
  const imageTooLarge = () => common.error(413, "PAYLOAD_TOO_LARGE: the body is over 10 MB");
  const parseDescription =
    "Parses with the athlete's units and custom exercise names. Nothing is saved. Shares a 5-per-minute limit with the other parse routes.";
  const imageNote = " The image is base64 in the JSON body; its bytes must match mimeType.";
  const structureNote = " Exercise sets are linked to the structure blocks' steps by blockId and stepNumber.";

  const parseRoutes = [
    ["/api/v1/parse-exercises", "Parse workout text into exercises", false, false],
    ["/api/v1/parse-exercises-from-image", "Parse a workout photo into exercises", true, false],
    ["/api/v1/parse-workout-structure", "Parse workout text into exercises and structure blocks", false, true],
    ["/api/v1/parse-workout-structure-from-image", "Parse a workout photo into exercises and structure", true, true],
  ] as const;
  for (const [path, summary, image, structure] of parseRoutes) {
    registry.registerPath({
      method: "post", path, tags: ["AI parsing"],
      summary,
      description: parseDescription + (structure ? structureNote : "") + (image ? imageNote : ""),
      security,
      request: {
        body: {
          required: true,
          content: json(image ? parseExercisesFromImageRequestSchema : parseExercisesRequestSchema),
        },
      },
      responses: {
        ...(structure
          ? aiOk("The parsed exercises and structure", c.ParseWorkoutStructureResponse)
          : aiOk("The exercises read (possibly none)", z.array(c.ParsedExercise))),
        ...common.validationError(), ...(image ? imageTooLarge() : {}), ...common.authenticatedResponses(),
        ...aiErrors(),
      },
    });
  }

  const parseWriteThrough = () =>
    common.error(422, "PARSE_WRITE_THROUGH_REQUIRED: parsing produced no exercise sets; nothing was changed");

  registry.registerPath({
    method: "post", path: "/api/v1/workouts/{id}/reparse", tags: ["AI parsing"],
    summary: "Re-parse a workout's text into exercise sets",
    description: "Parses the workout's prescription text (or the text sent, which is saved only if the parse succeeds) and REPLACES all its exercise sets and structure blocks. Send {} to parse the stored text. 5 per minute.",
    security,
    request: { params: workoutParams, body: { required: true, content: json(reparseWorkoutRouteSchema) } },
    responses: {
      ...aiOk("The parsed exercises, now saved", c.WorkoutReparseResponse), ...common.validationError(),
      ...workoutNotFound(), ...parseWriteThrough(), ...common.authenticatedResponses(), ...aiErrors(),
    },
  });

  registry.registerPath({
    method: "post", path: "/api/v1/workouts/{id}/reparse-from-image", tags: ["AI parsing"],
    summary: "Re-parse a workout from a photo",
    description: "Parses the photo and REPLACES all the workout's exercise sets and structure blocks. Shares the reparse limit of 5 per minute.",
    security,
    request: {
      params: workoutParams,
      body: { required: true, content: json(parseExercisesFromImageRequestSchema) },
    },
    responses: {
      ...aiOk("The parsed exercises, now saved", c.WorkoutReparseResponse), ...common.validationError(),
      ...workoutNotFound(), ...imageTooLarge(), ...parseWriteThrough(), ...common.authenticatedResponses(),
      ...aiErrors(),
    },
  });

  // No 502: a workout whose parse fails counts in `failed` instead.
  const { 502: _providerError, ...batchErrors } = aiErrors();
  registry.registerPath({
    method: "post", path: "/api/v1/workouts/batch-reparse", tags: ["AI parsing"],
    summary: "Re-parse every unstructured workout",
    description: "Parses each workout GET /api/v1/workouts/unstructured lists and saves its sets. A workout that fails counts in `failed` and does not fail the request. 2 per minute.",
    security,
    responses: {
      ...aiOk("Counts", z.object({ total: int(), parsed: int(), failed: int() })), ...common.authenticatedResponses(),
      ...batchErrors,
    },
  });
}

/** Custom exercises, assisted-migration reviews and the data export. */
function registerExerciseAndExportPaths({ registry, common, c }: Ctx): void {
  const security = common.security;

  registry.registerPath({
    method: "get", path: "/api/v1/custom-exercises", tags: ["Exercises"],
    summary: "List the athlete's custom exercises",
    description: "The AI parsers match these names in workout text.",
    security,
    responses: { ...ok("Custom exercises", z.array(c.CustomExercise)), ...common.authenticatedResponses() },
  });

  registry.registerPath({
    method: "post", path: "/api/v1/custom-exercises", tags: ["Exercises"],
    summary: "Create or update a custom exercise",
    description: 'Upserts by name: an existing exercise with the same name gets the new category. category defaults to "conditioning".',
    security,
    request: { body: { required: true, content: json(createCustomExerciseSchema) } },
    responses: {
      ...ok("The stored custom exercise", c.CustomExercise), ...common.validationError(),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "get", path: "/api/v1/workouts/migration/reviews", tags: ["Workouts"],
    summary: "List assisted-migration reviews",
    description: "Flags left by the automatic conversion of free-text workouts and plan days into exercise sets, newest first: at most 100, or the one for ownerType + ownerId.",
    security,
    request: { query: migrationReviewsQuerySchema },
    responses: {
      ...ok(
        "Review flags",
        z.array(
          createSelectSchema(structuredExerciseBackfillReviews).extend({
            ownerType: z.enum(["workoutLog", "planDay"]),
            status: z.enum(["needs_manual_review", "resolved"]),
            reason: z.string().nullable().openapi({
              description: "parse_returned_no_rows, low_confidence_conversion, auto_resolved, parse_error, or the athlete's own reason",
            }),
          }),
        ),
      ),
      ...common.validationError(), ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "post", path: "/api/v1/workouts/migration/reviews/resolve", tags: ["Workouts"],
    summary: "Resolve an assisted-migration review",
    description: 'action "reject" marks the conversion for manual review; "accept" and "edit" mark it resolved.',
    security,
    request: { body: { required: true, content: json(migrationReviewResolveSchema) } },
    responses: {
      ...ok("Resolved", z.object({ ok: z.literal(true) })), ...common.validationError(),
      ...common.error(404, "NOT_FOUND: no such workout or plan day for this user"), ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "get", path: "/api/v1/export", tags: ["Workouts"],
    summary: "Download the athlete's data",
    description: "A file download (Content-Disposition: attachment). `format=json` is the full data export, also used for GDPR portability; any other value, or none, is a CSV of the timeline and per-set data. 5 per minute.",
    security,
    request: {
      query: z.object({
        format: z.enum(["csv", "json"]).optional().openapi({ description: "Defaults to csv" }),
      }),
    },
    responses: {
      200: {
        description: "The export file",
        headers: {
          "Content-Disposition": {
            description: "attachment; filename=hyrox-training-data.csv (or .json)",
            schema: { type: "string" },
          },
        },
        content: {
          "text/csv": {
            schema: z.string().openapi({
              description: "Timeline rows (Date,Type,Status,Focus,Main Workout,Accessory,Notes,Duration,RPE), then, when there are any, a per-set section with weight and distance in the athlete's units",
            }),
          },
          "application/json": {
            schema: z
              .object({
                exportFormatVersion: z.literal(1).openapi({ type: "integer", enum: [1] }),
                exportedAt: z.string().datetime(),
                unitPreferences: z.object({ weightUnit: z.string(), distanceUnit: z.string() }),
              })
              .catchall(z.unknown())
              .openapi({
                description: "Every section of the athlete's data: profile, timeline, plans, exerciseSets, chatMessages, coachingMaterials, customExercises, timelineAnnotations, athleteFacts, connections, pushSubscriptions, deviceTokens, aiUsageLogs, nutrition, weeklyReviews, workoutStreams, planDayMoves, planAdjustmentProposals, consents, trainingStyleHistory, analyticsResults, maf and recycleBin. Its layout changes only with exportFormatVersion.",
              }),
          },
        },
      },
      ...common.authenticatedResponses(),
    },
  });
}
