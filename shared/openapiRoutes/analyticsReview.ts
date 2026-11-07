import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import {
  dateStringSchema,
  planDayPriorityEnum,
  planDayRecoveryEnum,
  planDaySkipReasonEnum,
  type SessionGrade,
  type SessionGradesResponse,
  sessionStreamStatusEnum,
  type WeeklyReview,
  weeklyReviewIntentSchema,
} from "../schema";
import { sessionGradesQuerySchema } from "../schema/types/analyticsRequests";
import { z } from "../schema/zod";
import type { OpenApiCommon } from "./common";

/** True only when the documented schema and the server's wire type are assignable both ways. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

/**
 * Session grades ("did the session do its job?") and the weekly review, whose
 * session rows carry the same grade chips. Registered by registerAnalyticsPaths.
 * Returns the SessionGrade component for the per-workout grade endpoint.
 */
export function registerReviewPaths(
  registry: OpenAPIRegistry,
  common: OpenApiCommon,
): { SessionGrade: z.ZodType } {
  const gradeEnums = registerSessionGradeEnums(registry);
  const SessionGrade = registerSessionGradesPath(registry, common, gradeEnums);
  registerWeeklyReviewPaths(registry, common, gradeEnums);
  return { SessionGrade };
}

// ---------------------------------------------------------------------------
// Session grades (also the chips on the weekly review)
// ---------------------------------------------------------------------------

/** The grade enums the session-grades payload and the weekly review's chips share. */
function registerSessionGradeEnums(registry: OpenAPIRegistry) {
  const Intent = registry.register("SessionGradeIntent", z.enum(["easy", "threshold"]));
  const Purpose = registry.register(
    "SessionGradeRunPurpose",
    z.enum(["easy", "recovery", "long", "threshold", "intervals", "steady", "race"]),
  );
  const Verdict = registry.register(
    "SessionGradeVerdict",
    z.enum([
      "on_target",
      "crept_up",
      "too_hard",
      "drifted_harder",
      "under",
      "inconclusive",
      "ungradeable",
    ]),
  );
  const Confidence = registry.register("SessionGradeConfidence", z.enum(["high", "medium", "low"]));
  const StreamStatus = registry.register(
    "SessionGradeStreamStatus",
    z.enum([...sessionStreamStatusEnum, "pending", "not_applicable"]).openapi({
      description:
        "The run's Strava stream: `pending` = not fetched yet, `not_applicable` = no Strava recording",
    }),
  );
  return { Intent, Purpose, Verdict, Confidence, StreamStatus };
}

type SessionGradeEnums = ReturnType<typeof registerSessionGradeEnums>;

function registerSessionGradesPath(
  registry: OpenAPIRegistry,
  common: OpenApiCommon,
  { Intent, Purpose, Verdict, Confidence, StreamStatus }: SessionGradeEnums,
): z.ZodType {
  const Phase = registry.register(
    "SessionGradeTrainingPhase",
    z.enum(["early", "build", "peak", "taper", "race_week"]),
  );

  const SessionGradeSchema = registry.register(
    "SessionGrade",
    z.object({
      workoutLogId: z.string(),
      planDayId: z.string(),
      planId: z.string().nullable(),
      date: z.string(),
      weekNumber: z.number().int().nullable(),
      title: z.string().openapi({ description: "The plan day's title" }),
      intent: Intent,
      purpose: Purpose,
      intentReason: z.string().nullable(),
      verdict: Verdict,
      headline: z.string(),
      evidence: z
        .array(z.string())
        .openapi({ description: "One to three sentences backing the verdict" }),
      confidence: Confidence.nullable(),
      dataSource: z.enum(["stream", "summary"]).nullable(),
      streamStatus: StreamStatus,
      ungradeableReason: z.enum(["no_targets", "no_data", "too_short"]).nullable(),
      targets: z.object({
        easyCeilingHr: z.number().nullable(),
        thresholdHr: z.object({ min: z.number(), max: z.number() }).nullable(),
        z5FloorHr: z.number().nullable(),
        hrBasis: z.enum(["measured", "age_estimated", "maf"]).nullable(),
        easyPace: z
          .object({ fast: z.number(), slow: z.number() })
          .nullable()
          .openapi({ description: "Seconds per km" }),
        thresholdPace: z.number().nullable().openapi({ description: "Seconds per km" }),
        paceSource: z.enum(["plan", "engine", "history"]).nullable(),
      }),
      easy: z
        .object({
          movingMinutes: z.number(),
          avgHr: z.number().nullable(),
          pctAboveCeiling: z.number().nullable(),
          firstThirdHr: z.number().nullable(),
          lastThirdHr: z.number().nullable(),
          hrDriftPct: z.number().nullable(),
          avgPaceSecPerKm: z.number().nullable(),
          pctFasterThanEasy: z.number().nullable(),
          excludedFinishMinutes: z.number().nullable(),
        })
        .nullable(),
      threshold: z
        .object({
          segmentation: z.enum(["reps", "continuous", "whole_run"]),
          workMinutes: z.number(),
          repCount: z.number().int(),
          workAvgPaceSecPerKm: z.number().nullable(),
          paceDeltaPct: z.number().nullable(),
          workAvgHr: z.number().nullable(),
          pctWorkZ4: z.number().nullable(),
          pctWorkZ5: z.number().nullable(),
          firstRepHr: z.number().nullable(),
          lastRepHr: z.number().nullable(),
          decouplingPct: z.number().nullable(),
        })
        .nullable(),
      countsInRollup: z.boolean().openapi({
        description: "False for all but the best-recorded log when one plan day has several",
      }),
    }),
  );
  type _SessionGradeMatches = Assert<Same<z.infer<typeof SessionGradeSchema>, SessionGrade>>;

  const VerdictCounts = registry.register(
    "SessionGradeVerdictCounts",
    z.object({
      onTarget: z.number().int(),
      creptUp: z.number().int(),
      tooHard: z.number().int(),
      driftedHarder: z.number().int(),
      under: z.number().int(),
      inconclusive: z.number().int(),
      ungradeable: z.number().int(),
    }),
  );

  const RollupCounts = registry.register(
    "SessionGradeRollupCounts",
    z.object({
      easy: VerdictCounts,
      threshold: VerdictCounts,
      graded: z.number().int(),
      onTarget: z.number().int(),
      onTargetRate: z
        .number()
        .nullable()
        .openapi({ description: "onTarget / graded, 0-1; null when nothing was graded" }),
      driftedHarder: z.number().int(),
      easyTooHard: z.number().int(),
      ungradeable: z.number().int(),
      pending: z.number().int(),
      plannedGradeable: z.number().int(),
    }),
  );

  const SessionGradesSchema = registry.register(
    "SessionGradesResponse",
    z.object({
      plan: z
        .object({
          id: z.string(),
          name: z.string(),
          totalWeeks: z.number().int(),
          startDate: z.string().nullable(),
          currentWeek: z.number().int().nullable(),
        })
        .nullable(),
      sessions: z.array(SessionGradeSchema).openapi({ description: "Newest first" }),
      weeks: z.array(
        z.object({
          weekNumber: z.number().int(),
          weekStart: z.string().nullable(),
          block: z.number().int(),
          phase: Phase.nullable(),
          deload: z.boolean(),
          counts: RollupCounts,
        }),
      ),
      blocks: z.array(
        z.object({
          block: z.number().int(),
          firstWeek: z.number().int(),
          lastWeek: z.number().int(),
          phases: z.array(Phase),
          includesDeload: z.boolean(),
          counts: RollupCounts,
        }),
      ),
      totals: RollupCounts.nullable(),
    }),
  );
  type _SessionGradesMatches = Assert<
    Same<z.infer<typeof SessionGradesSchema>, SessionGradesResponse>
  >;

  registry.registerPath({
    method: "get",
    path: "/api/v1/session-grades",
    tags: ["Analytics"],
    summary: "Grade a plan's runs",
    description:
      '"Did the session do its job?" for every graded run of one plan, rolled up by plan week and block. Computed on read. With no plan at all the payload is empty (`plan: null`), not an error. Unknown query parameters are refused.',
    security: common.security,
    request: { query: sessionGradesQuerySchema },
    responses: {
      200: {
        description: "The plan's grades",
        content: { "application/json": { schema: SessionGradesSchema } },
      },
      ...common.validationError("A malformed `planId`, or an unknown query parameter"),
      ...common.error(404, "NOT_FOUND: `planId` is not one of the athlete's plans"),
      ...common.authenticatedResponses(),
    },
  });
  return SessionGradeSchema;
}

// ---------------------------------------------------------------------------
// Weekly review
// ---------------------------------------------------------------------------

function registerWeeklyReviewPaths(
  registry: OpenAPIRegistry,
  common: OpenApiCommon,
  grades: SessionGradeEnums,
): void {
  const Counts = registry.register(
    "WeeklyReviewCounts",
    z.object({
      sessionsLogged: z.number().int().openapi({ description: "Sessions logged, planned or not" }),
      sessionsPlanned: z.number().int(),
      plannedCompleted: z.number().int(),
      missed: z.number().int(),
      skipped: z.number().int(),
      outstanding: z.number().int(),
      excused: z.number().int(),
      letGo: z.number().int(),
      totalDurationMin: z.number(),
      avgRpe: z.number().nullable(),
    }),
  );

  const WeeklyReviewSchema = registry.register(
    "WeeklyReview",
    z.object({
      weekStart: z.string().openapi({ description: "Monday" }),
      weekEnd: z.string().openapi({ description: "Sunday, inclusive" }),
      timezone: z.string().openapi({
        description: "The zone the week was resolved in (UTC when the athlete's is unusable)",
      }),
      isCurrentWeek: z.boolean(),
      weeklyGoal: z.number().int(),
      hasPlan: z.boolean(),
      current: Counts,
      previous: Counts,
      deltas: z.object({
        sessionsLogged: z.number(),
        totalDurationMin: z.number(),
        avgRpe: z.number().nullable(),
      }),
      sessions: z.array(
        z.object({
          workoutLogId: z.string(),
          date: z.string(),
          focus: z.string(),
          durationMin: z.number().nullable(),
          rpe: z.number().nullable(),
          source: z.string(),
          planDayId: z.string().nullable(),
          compliancePct: z.number().nullable(),
          matchedSetCount: z.number().nullable(),
          addedSetCount: z.number().nullable(),
          removedSetCount: z.number().nullable(),
          grade: z
            .object({
              intent: grades.Intent,
              purpose: grades.Purpose,
              verdict: grades.Verdict,
              confidence: grades.Confidence.nullable(),
              headline: z.string(),
              streamStatus: grades.StreamStatus,
            })
            .nullable()
            .optional()
            .openapi({
              description: "Null for a session that is not a graded run; absent if grading failed",
            }),
        }),
      ),
      plannedDays: z.array(
        z.object({
          planDayId: z.string(),
          date: z.string(),
          focus: z.string(),
          status: z.enum(["planned", "missed", "skipped"]),
          skipReason: z.enum(planDaySkipReasonEnum).nullable(),
          priority: z.enum(planDayPriorityEnum).nullable(),
          recovery: z.enum(planDayRecoveryEnum).nullable(),
          planName: z.string().nullable(),
          excused: z.boolean(),
        }),
      ),
      personalRecords: z.array(
        z.object({
          exerciseName: z.string(),
          customLabel: z.string().nullable(),
          category: z.string(),
          metric: z.enum(["maxWeight", "maxDistance", "bestTime", "estimated1RM"]),
          value: z.number(),
          date: z.string(),
          workoutLogId: z.string(),
        }),
      ),
      annotations: z.array(
        z.object({
          id: z.string(),
          type: z.string(),
          startDate: z.string(),
          endDate: z.string(),
          note: z.string().nullable(),
        }),
      ),
      intent: z.string().nullable(),
      previousIntent: z.string().nullable(),
      gradeSummary: z
        .object({
          graded: z.number().int(),
          onTarget: z.number().int(),
          driftedHarder: z.number().int(),
          easyTooHard: z.number().int(),
        })
        .nullable()
        .optional()
        .openapi({
          description: "Null when the week had no graded runs; absent if grading failed",
        }),
    }),
  );
  type _WeeklyReviewMatches = Assert<Same<z.infer<typeof WeeklyReviewSchema>, WeeklyReview>>;

  registry.registerPath({
    method: "get",
    path: "/api/v1/weekly-review",
    tags: ["Analytics"],
    summary: "Get a weekly review",
    description:
      "One Monday-to-Sunday week in the athlete's timezone, compared with the week before.",
    security: common.security,
    request: {
      query: z.object({
        week: dateStringSchema.optional().openapi({
          description:
            "Any real calendar date inside the wanted week; defaults to the last completed week",
          example: "2026-03-25",
        }),
      }),
    },
    responses: {
      200: {
        description: "The review",
        content: { "application/json": { schema: WeeklyReviewSchema } },
      },
      ...common.error(400, "BAD_REQUEST: `week` is not a real YYYY-MM-DD date"),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/weekly-review/intent",
    tags: ["Analytics"],
    summary: "Set the intent for a week",
    description:
      "Upserts what the athlete wants from the week containing `week` (stored on its Monday). An empty, blank or null `intent` clears it.",
    security: common.security,
    request: {
      body: {
        content: {
          "application/json": {
            schema: weeklyReviewIntentSchema,
            example: { week: "2026-03-30", intent: "Three easy runs and one long one" },
          },
        },
      },
    },
    responses: {
      200: {
        description: "The stored intent",
        content: {
          "application/json": {
            schema: z.object({
              weekStart: z.string().openapi({ description: "Monday of the week" }),
              intent: z.string().nullable(),
            }),
          },
        },
      },
      ...common.validationError(),
      ...common.authenticatedResponses(),
    },
  });
}
