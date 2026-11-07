import type { OpenAPIRegistry, ResponseConfig } from "@asteasolutions/zod-to-openapi";
import { createSelectSchema } from "drizzle-zod";

import {
  dateStringSchema,
  type HeatMapMuscle,
  mafTestResults,
  mafWorkoutAnalysis,
  MOVEMENT_PATTERNS,
  type MovementPattern,
  MUSCLE_HEAT_MAP_GROUPS,
  type OverviewAnalysisResult,
  type PersonalRecord,
  type RacePredictionResponse,
  type RagInfo,
  type TrainingOverview,
  type TrainingSummary,
} from "../schema";
import { overviewAnalysisQuerySchema } from "../schema/types/analyticsRequests";
import { z } from "../schema/zod";
import { registerReviewPaths } from "./analyticsReview";
import type { OpenApiCommon } from "./common";

/**
 * Compile-time guard: true only when the documented schema and the TypeScript
 * wire type the server builds are assignable both ways, so a field added,
 * dropped or made nullable on one side fails `tsc` until the other follows.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

const timestamp = () => z.string().datetime();

/**
 * Analytics: training overview and home summary, weekly review, personal
 * records, per-exercise progression, race prediction, session grades, MAF
 * history, and the two stored AI readings (Coach Insights, Overview analysis).
 *
 * Every response here is computed or stored by the server; dates are the
 * athlete's local calendar days as `YYYY-MM-DD`, timestamps are ISO 8601.
 * Weights are in the athlete's weight unit (kg or lbs), distances in metres or
 * feet (feet when their distance unit is miles), set times in minutes.
 */
export function registerAnalyticsPaths(
  registry: OpenAPIRegistry,
  common: OpenApiCommon,
): AnalyticsComponents {
  registerOverviewPaths(registry, common);
  const { SessionGrade } = registerReviewPaths(registry, common);
  registerRecordPaths(registry, common);
  registerRacePredictionPath(registry, common);
  const maf = registerMafPath(registry, common);
  registerAiReadingPaths(registry, common);
  return { SessionGrade, ...maf };
}

/**
 * Components registered here that endpoints documented elsewhere also return:
 * GET /api/v1/workouts/{id}/session-grade answers `{ grade: SessionGrade | null }`,
 * and the /api/v1/workouts/{id}/maf-test writes answer MAF rows.
 */
export interface AnalyticsComponents {
  readonly SessionGrade: z.ZodType;
  readonly MafTestResult: z.ZodType;
  readonly MafWorkoutAnalysis: z.ZodType;
}

// ---------------------------------------------------------------------------
// Shared query and error pieces
// ---------------------------------------------------------------------------

const dateRangeQuery = z.object({
  from: dateStringSchema
    .optional()
    .openapi({ description: "First day of the window, inclusive; unbounded when omitted" }),
  to: dateStringSchema.optional().openapi({
    description:
      "Last day of the window, inclusive; a day after the athlete's today is clamped to today",
  }),
});

const badDateResponse = (common: OpenApiCommon) =>
  common.error(400, "BAD_REQUEST: `from` or `to` is not YYYY-MM-DD");

/**
 * What the AI consent and budget middleware answer before an AI-backed handler
 * runs, plus any codes the handler itself adds to the same statuses. Spread
 * after authenticatedResponses(): its 429 description replaces the generic one.
 */
function aiGateResponses(
  common: OpenApiCommon,
  handlerCodes: { readonly 429?: string; readonly 503?: string } = {},
): Record<number, ResponseConfig> {
  const also = (text: string | undefined) => (text ? `; or ${text}` : "");
  return {
    ...common.error(403, "AI_COACH_DISABLED: the athlete has not turned AI coaching on (Settings)"),
    ...common.error(
      429,
      `RATE_LIMITED; or AI_BUDGET_EXCEEDED, the athlete's rolling 24-hour AI budget is spent (that body adds integer \`currentCostCents\` and \`limitCents\`)${also(handlerCodes[429])}`,
    ),
    ...common.error(
      503,
      `AI_FEATURES_DISABLED (AI is switched off), AI_GLOBAL_BUDGET_EXCEEDED (the app-wide daily AI budget is spent) or AI_BUDGET_UNAVAILABLE (the budget check failed)${also(handlerCodes[503])}; try again later`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Training overview and home summary
// ---------------------------------------------------------------------------

function registerOverviewPaths(registry: OpenAPIRegistry, common: OpenApiCommon): void {
  const AcwrZone = registry.register(
    "TrainingOverviewAcwrZone",
    z.enum(["insufficient_data", "undertraining", "sweet_spot", "yellow", "danger"]),
  );
  const HrZone = registry.register(
    "TrainingOverviewHrZone",
    z
      .enum(["z1", "z2", "z3", "z4", "z5"])
      .openapi({ description: "Karvonen %HRR heart-rate zone" }),
  );
  const LoadVector = registry.register(
    "TrainingOverviewLoadVector",
    z.enum(["posterior_chain", "anterior_chain", "unilateral_stability", "elastic_tendon"]),
  );

  const StationCoverage = registry.register(
    "TrainingOverviewStationCoverage",
    z.object({
      station: z.string(),
      lastTrained: z.string().nullable(),
      daysSince: z.number().int().nullable(),
    }),
  );

  const Stats = registry.register(
    "TrainingOverviewStats",
    z.object({
      totalWorkouts: z.number().int(),
      avgPerWeek: z.number(),
      totalDuration: z.number().openapi({ description: "Minutes" }),
      avgDuration: z
        .number()
        .openapi({ description: "Minutes per workout that recorded a duration; 0 when none did" }),
      avgRpe: z.number().nullable(),
      totalRunningMeters: z.number().openapi({ description: "Running distance only, in metres" }),
      avgCompliancePct: z.number().nullable().openapi({
        description: "Mean plan adherence over the sessions that were due; null without a plan",
      }),
    }),
  );

  const TrendPoint = z.object({
    date: z.string(),
    utss: z.number(),
    acwr: z.number().nullable(),
    zone: AcwrZone,
    tsb: z.number().nullable().openapi({ description: "Training Stress Balance (Form)" }),
    monotony: z.number().nullable(),
    strain: z.number().nullable(),
    hrTss: z.number().nullable(),
    hrZone: HrZone.nullable(),
    tss: z.number().nullable(),
    acuteEwma: z.number().nullable(),
    chronicEwma: z.number().nullable(),
  });

  const TrainingLoad = z.object({
    currentUtss: z.number(),
    acuteAvg: z.number().openapi({ description: "Acute fatigue: 7-day EWMA of UTSS" }),
    chronicAvg: z.number().openapi({ description: "Chronic fitness: 28-day EWMA of UTSS" }),
    acwr: z.number().nullable(),
    zone: AcwrZone,
    tsb: z.number().nullable(),
    monotony: z.number().nullable(),
    strain: z.number().nullable(),
    monotonyZone: z.enum(["unknown", "ok", "elevated", "high_risk"]).openapi({
      description: "`unknown` means no load at all that week, not a safe reading",
    }),
    hrTss: z.number().nullable(),
    hrZone: HrZone.nullable(),
    tss: z.number().nullable(),
    hrZones: z.array(
      z.object({
        zone: HrZone,
        minHr: z.number(),
        maxHr: z.number(),
        minHrr: z.number(),
      }),
    ),
    estimatedLthr: z.number().nullable(),
    powerTssEstimated: z.boolean(),
    flaggedVectors: z.array(LoadVector),
    activeRestrictions: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        severity: z.enum(["info", "caution", "danger"]),
        expiresOn: z.string().nullable(),
        vector: LoadVector.optional(),
        rationale: z.string(),
      }),
    ),
    downshiftRationale: z.string().nullable(),
    trend: z.array(TrendPoint),
  });

  const BodySystemLoad = z.object({
    asOf: z.string().openapi({ description: "The day the newest 7-day block ends on" }),
    weeks: z.array(z.object({ start: z.string(), end: z.string() })).openapi({
      description: "The six rolling 7-day blocks, oldest first",
    }),
    systems: z.array(
      z.object({
        system: z.enum(["aerobic", "running_impact", "leg_muscle", "upper_pull"]),
        current: z.number().openapi({ description: "Load over the last 7 days, in RPE x minutes" }),
        baseline: z.number().nullable(),
        ratio: z.number().nullable(),
        status: z.enum([
          "insufficient_data",
          "minimal",
          "new",
          "low",
          "normal",
          "high",
          "very_high",
        ]),
        sixWeekHigh: z.boolean(),
        previousPeak: z.number().nullable(),
        weekly: z
          .array(z.number().nullable())
          .openapi({ description: "One total per block in `weeks`, oldest first" }),
      }),
    ),
    sessionCount: z.number().int(),
    estimatedSessions: z.number().int(),
    unattributedSessions: z.number().int(),
    unscoredSessions: z.number().int(),
  });

  const coverageCounts = {
    label: z.string(),
    sessionCount: z.number().int(),
    totalSets: z.number().int(),
    lastTrained: z.string().nullable(),
    daysSince: z.number().int().nullable(),
  };

  const TrainingOverviewSchema = registry.register(
    "TrainingOverview",
    z.object({
      weeklySummaries: z.array(
        z.object({
          weekStart: z.string().openapi({ description: "Monday of the week" }),
          workoutCount: z.number().int(),
          totalDuration: z
            .number()
            .openapi({ description: "Minutes, summed over the workouts that recorded one" }),
          avgRpe: z.number().nullable(),
          categoryBreakdown: z.record(z.string(), z.number()),
          workoutsWithDuration: z.number().int(),
          rpeCount: z.number().int(),
          runningMeters: z.number().openapi({ description: "Running distance only, in metres" }),
        }),
      ),
      workoutDates: z.array(z.string()),
      categoryTotals: z.record(
        z.string(),
        z.object({ count: z.number().int(), totalSets: z.number().int() }),
      ),
      stationCoverage: z.array(StationCoverage),
      movementPatternCoverage: z.array(
        z.object({
          pattern: z.enum(
            MOVEMENT_PATTERNS.map(({ pattern }) => pattern) as [
              MovementPattern,
              ...MovementPattern[],
            ],
          ),
          ...coverageCounts,
        }),
      ),
      muscleGroupCoverage: z.array(
        z.object({
          muscle: z.enum(
            MUSCLE_HEAT_MAP_GROUPS.map(({ muscle }) => muscle) as [
              HeatMapMuscle,
              ...HeatMapMuscle[],
            ],
          ),
          bodyRegion: z.enum(["upper", "core", "lower"]),
          ...coverageCounts,
        }),
      ),
      currentStreak: z.number().int(),
      weeklyCompletedWorkouts: z.number().int(),
      weeklyGoal: z.number().int(),
      currentStats: Stats,
      previousStats: Stats.optional().openapi({
        description: "The equal-length window just before `from`; absent without `from`",
      }),
      trainingLoad: TrainingLoad,
      bodySystemLoad: BodySystemLoad.optional().openapi({
        description: "Always sent by this server",
      }),
    }),
  );
  type _TrainingOverviewMatches = Assert<
    Same<z.infer<typeof TrainingOverviewSchema>, TrainingOverview>
  >;

  registry.registerPath({
    method: "get",
    path: "/api/v1/training-overview",
    tags: ["Analytics"],
    summary: "Get the training overview",
    description:
      "Weekly summaries, coverage, streak, period stats and the training-load model for a date window (all time without `from`). Training sessions only.",
    security: common.security,
    request: { query: dateRangeQuery },
    responses: {
      200: {
        description: "The overview",
        content: { "application/json": { schema: TrainingOverviewSchema } },
      },
      ...badDateResponse(common),
      ...common.authenticatedResponses(),
    },
  });

  const TrainingSummarySchema = registry.register(
    "TrainingOverviewSummary",
    z.object({
      currentStreak: z.number().int(),
      weeklyCompletedWorkouts: z.number().int(),
      weeklyGoal: z.number().int(),
      stationCoverage: z.array(StationCoverage).openapi({
        description: "A station last trained before the lookback window has `lastTrained: null`",
      }),
      coverageLookbackDays: z.number().int(),
    }),
  );
  type _TrainingSummaryMatches = Assert<
    Same<z.infer<typeof TrainingSummarySchema>, TrainingSummary>
  >;

  registry.registerPath({
    method: "get",
    path: "/api/v1/training-overview/summary",
    tags: ["Analytics"],
    summary: "Get the home summary card",
    description:
      "Streak, this week's count against the goal, and station coverage over a bounded lookback.",
    security: common.security,
    responses: {
      200: {
        description: "The summary",
        content: { "application/json": { schema: TrainingSummarySchema } },
      },
      ...common.authenticatedResponses(),
    },
  });
}

// ---------------------------------------------------------------------------
// Personal records and per-exercise progression
// ---------------------------------------------------------------------------

function registerRecordPaths(registry: OpenAPIRegistry, common: OpenApiCommon): void {
  const RecordValue = registry.register(
    "PersonalRecordValue",
    z.object({ value: z.number(), date: z.string(), workoutLogId: z.string() }),
  );
  const PersonalRecordSchema = registry.register(
    "PersonalRecord",
    z.object({
      category: z.string(),
      customLabel: z.string().nullable().optional(),
      maxWeight: RecordValue.optional().openapi({ description: "In the athlete's weight unit" }),
      maxDistance: RecordValue.optional().openapi({
        description: "Metres, or feet when the athlete uses miles",
      }),
      bestTime: RecordValue.optional().openapi({
        description:
          "Minutes; longer is better for holds. Only at the effort size the athlete repeats most",
      }),
      estimated1RM: RecordValue.optional().openapi({
        description: "Epley estimate from 2-10 rep strength sets",
      }),
    }),
  );
  type _PersonalRecordMatches = Assert<Same<z.infer<typeof PersonalRecordSchema>, PersonalRecord>>;

  const exerciseKeyDescription =
    "Keyed by exercise: the catalogue exercise name, or `custom:<label>` for a custom exercise";

  registry.registerPath({
    method: "get",
    path: "/api/v1/personal-records",
    tags: ["Analytics"],
    summary: "Get personal records",
    description:
      "All-time bests per exercise within the window, read in the athlete's current units.",
    security: common.security,
    request: { query: dateRangeQuery },
    responses: {
      200: {
        description: "Records by exercise",
        content: {
          "application/json": {
            schema: z
              .record(z.string(), PersonalRecordSchema)
              .openapi({ description: exerciseKeyDescription }),
          },
        },
      },
      ...badDateResponse(common),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/exercise-analytics",
    tags: ["Analytics"],
    summary: "Get per-exercise daily progression",
    description:
      "One row per exercise per training day, oldest first, in the athlete's current units.",
    security: common.security,
    request: { query: dateRangeQuery },
    responses: {
      200: {
        description: "Daily totals by exercise",
        content: {
          "application/json": {
            schema: z
              .record(
                z.string(),
                z.array(
                  z.object({
                    date: z.string(),
                    totalVolume: z.number().openapi({ description: "Sum of weight x reps" }),
                    maxWeight: z.number(),
                    totalSets: z.number().int(),
                    totalReps: z.number(),
                    totalDistance: z.number(),
                  }),
                ),
              )
              .openapi({ description: exerciseKeyDescription }),
          },
        },
      },
      ...badDateResponse(common),
      ...common.authenticatedResponses(),
    },
  });
}

// ---------------------------------------------------------------------------
// Race prediction
// ---------------------------------------------------------------------------

function registerRacePredictionPath(registry: OpenAPIRegistry, common: OpenApiCommon): void {
  const Confidence = registry.register(
    "RacePredictionConfidence",
    z.enum(["low", "medium", "high"]),
  );

  const RacePredictionSchema = registry.register(
    "RacePrediction",
    z.object({
      totalFinishSeconds: z.number(),
      segments: z.array(
        z.object({
          index: z.number().int().openapi({ description: "1-based race order (1-16)" }),
          kind: z.enum(["run", "station"]),
          exerciseName: z.string(),
          label: z.string(),
          estimatedSeconds: z.number(),
          basis: z.enum(["logged", "benchmark", "blended"]),
          confidence: Confidence,
          sampleSize: z.number().int(),
        }),
      ),
      transitionSeconds: z.number(),
      aiUsed: z.boolean(),
      aiUnavailableReason: z
        .enum(["ai_disabled", "ai_consent_off", "ai_budget_exceeded", "ai_error"])
        .nullable()
        .optional()
        .openapi({
          description: "Why the deterministic estimate was returned instead of the AI one",
        }),
      overallConfidence: Confidence,
      narrative: z
        .string()
        .nullable()
        .openapi({ description: "Markdown; null on the deterministic path" }),
      division: z.enum(["open", "pro"]),
      gender: z.enum(["male", "female", "prefer_not_to_say"]).nullable(),
      genderAssumed: z.boolean(),
      ageGroup: z.string().nullable(),
      ageGroupAssumed: z.boolean(),
      percentile: z
        .object({
          fasterThanPct: z.number(),
          cohortLabel: z.string(),
          cohortSize: z.number().int(),
          basis: z.enum(["age_group", "division_gender"]),
        })
        .nullable(),
      raceReadiness: z
        .object({
          tsb: z.number().nullable(),
          status: z.enum([
            "insufficient_data",
            "peaked",
            "fresh",
            "neutral",
            "fatigued",
            "very_fatigued",
          ]),
          guidance: z.string(),
        })
        .nullable()
        .optional(),
      dataCompleteness: z.object({
        stationsWithData: z.number().int(),
        totalStations: z.number().int(),
        hasRunData: z.boolean(),
      }),
      generatedAt: timestamp(),
      stale: z.boolean().openapi({
        description: "A training session was logged or deleted after this was generated",
      }),
    }),
  );
  type _RacePredictionMatches = Assert<
    Same<Omit<z.infer<typeof RacePredictionSchema>, "stale">, RacePredictionResponse>
  >;

  registry.registerPath({
    method: "get",
    path: "/api/v1/race-prediction",
    tags: ["Analytics"],
    summary: "Get the predicted HYROX finish time",
    description:
      "Returns the stored prediction at once (no AI spend). With `refresh=1`, or when none is stored, generates and stores a fresh one; AI is used only when the athlete has it on and budget allows, else a deterministic estimate is returned. Rate limited to 12 per window.",
    security: common.security,
    request: {
      query: z.object({
        refresh: z
          .enum(["1"])
          .optional()
          .openapi({ description: "`1` regenerates; any other value is ignored" }),
      }),
    },
    responses: {
      200: {
        description: "The prediction",
        content: { "application/json": { schema: RacePredictionSchema } },
      },
      ...common.authenticatedResponses(),
    },
  });
}

// ---------------------------------------------------------------------------
// MAF test history
// ---------------------------------------------------------------------------

function registerMafPath(
  registry: OpenAPIRegistry,
  common: OpenApiCommon,
): Pick<AnalyticsComponents, "MafTestResult" | "MafWorkoutAnalysis"> {
  const MafTestResult = registry.register(
    "MafTestResult",
    createSelectSchema(mafTestResults)
      .omit({ conditions: true, metrics: true, createdAt: true })
      .extend({
        conditions: z
          .object({ source: z.string(), workoutLogId: z.string() })
          .nullable()
          .openapi({ description: "Where the test came from; `workoutLogId` is the tagged run" }),
        metrics: z
          .object({
            durationSeconds: z.number().nullable(),
            distanceMeters: z.number().nullable(),
            avgHeartRate: z.number().nullable(),
            maxHeartRate: z.number().nullable(),
            mafCeilingUsed: z.number(),
          })
          .nullable(),
        createdAt: timestamp().nullable().openapi({ description: "When the run was tagged" }),
      }),
  );

  const MafWorkoutAnalysis = registry.register(
    "MafWorkoutAnalysis",
    createSelectSchema(mafWorkoutAnalysis)
      .omit({ analysisDetails: true, createdAt: true })
      .extend({
        classification: z.string().nullable().openapi({
          description: "`compliant`, `mostly_compliant` or `over_ceiling`",
        }),
        compliancePct: z.number().int().nullable().openapi({ description: "0-100" }),
        analysisDetails: z
          .object({
            avgHeartRate: z.number(),
            maxHeartRate: z.number().nullable(),
            ceiling: z.number(),
            avgOverBy: z.number(),
            maxOverBy: z.number().nullable(),
          })
          .nullable(),
        createdAt: timestamp().nullable(),
      }),
  );

  registry.registerPath({
    method: "get",
    path: "/api/v1/maf-tests",
    tags: ["Analytics"],
    summary: "Get MAF test history",
    description:
      "The newest 200 MAF tests and compliance analyses, with the date of each tagged workout.",
    security: common.security,
    responses: {
      200: {
        description: "Tests, analyses and workout dates",
        content: {
          "application/json": {
            schema: z.object({
              tests: z.array(MafTestResult).openapi({ description: "Newest first" }),
              analysis: z.array(MafWorkoutAnalysis).openapi({ description: "Newest first" }),
              workoutDates: z.record(z.string(), z.string()).openapi({
                description:
                  "Workout id to its YYYY-MM-DD date, for every tagged workout that still exists",
              }),
            }),
          },
        },
      },
      ...common.authenticatedResponses(),
    },
  });
  return { MafTestResult, MafWorkoutAnalysis };
}

// ---------------------------------------------------------------------------
// Stored AI readings: Coach Insights and the Overview chart analysis
// ---------------------------------------------------------------------------

function registerAiReadingPaths(registry: OpenAPIRegistry, common: OpenApiCommon): void {
  const RagInfoSchema = registry.register(
    "AnalyticsRagInfo",
    z.object({
      source: z.enum(["rag", "legacy", "none"]),
      chunkCount: z.number().int(),
      chunks: z.array(z.string()).optional().openapi({ description: "Development servers only" }),
      sources: z.array(z.string()).optional().openapi({
        description: "Titles of the athlete's coaching materials the excerpts came from",
      }),
      materialCount: z.number().int().optional(),
      fallbackReason: z.string().optional().openapi({ description: "Development servers only" }),
    }),
  );
  type _RagInfoMatches = Assert<Same<z.infer<typeof RagInfoSchema>, RagInfo>>;

  const stale = z
    .boolean()
    .openapi({ description: "A workout was logged or deleted after this was generated" });

  const CoachInsights = registry.register(
    "CoachInsights",
    z.object({
      insights: z.string().nullable().openapi({
        description:
          "Markdown; null when none has been generated yet, and then no other field is present",
      }),
      ragInfo: RagInfoSchema.optional(),
      generatedAt: timestamp().optional(),
      stale: stale.optional(),
    }),
  );

  const CoachInsightsResult = registry.register(
    "CoachInsightsResult",
    z.object({
      insights: z.string().openapi({ description: "Markdown" }),
      ragInfo: RagInfoSchema,
      generatedAt: timestamp(),
      stale: z.boolean().openapi({ description: "Always false" }),
    }),
  );

  registry.registerPath({
    method: "get",
    path: "/api/v1/coach-insights",
    tags: ["Analytics"],
    summary: "Get the stored Coach Insights",
    description:
      "The last generated analysis of progress against the athlete's goal, without spending AI.",
    security: common.security,
    responses: {
      200: {
        description: "The stored insights, or `insights: null`",
        content: { "application/json": { schema: CoachInsights } },
      },
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/coach-insights",
    tags: ["Analytics"],
    summary: "Regenerate Coach Insights",
    description:
      "Runs the AI analysis now and stores it. Can take tens of seconds. Rate limited to 3 per window.",
    security: common.security,
    responses: {
      200: {
        description: "The fresh insights",
        content: { "application/json": { schema: CoachInsightsResult } },
      },
      ...common.error(400, "AI_INVALID_INPUT: the AI provider refused the request"),
      ...common.error(502, "AI_ERROR: the AI provider failed"),
      ...common.authenticatedResponses(),
      ...aiGateResponses(common, {
        429: "AI_QUOTA_EXCEEDED, the AI provider's own quota",
        503: "AI_UNAVAILABLE (the AI provider is down)",
      }),
    },
  });

  const Sections = registry.register(
    "OverviewAnalysisSections",
    z
      .object({
        trainingLoad: z.string().optional(),
        bodySystems: z.string().optional(),
        formMonotony: z.string().optional(),
        objectiveLoad: z.string().optional(),
        weeklyWorkouts: z.string().optional(),
        rpeDuration: z.string().optional(),
        consistency: z.string().optional(),
      })
      .openapi({
        description:
          "One short Markdown reading per Overview chart; only charts that had enough data have a key",
      }),
  );

  const rangeDays = z.number().int().nullable().optional().openapi({
    description:
      "The days the readings cover, ending on the athlete's today; null for all time. Absent on an analysis stored before ranges existed",
  });

  const OverviewAnalysis = registry.register(
    "OverviewAnalysis",
    z.object({
      sections: Sections.nullable().openapi({
        description:
          "Null when nothing is stored, or the stored analysis covers another `range`; no other field is present then",
      }),
      ragInfo: RagInfoSchema.optional(),
      generatedAt: timestamp().optional(),
      rangeDays,
      stale: stale.optional(),
    }),
  );

  const OverviewAnalysisResultSchema = registry.register(
    "OverviewAnalysisResult",
    z.object({
      sections: Sections,
      ragInfo: RagInfoSchema.optional(),
      generatedAt: timestamp(),
      rangeDays,
      stale: z.boolean().openapi({ description: "Always false" }),
    }),
  );
  type _OverviewAnalysisMatches = Assert<
    Same<Omit<z.infer<typeof OverviewAnalysisResultSchema>, "stale">, OverviewAnalysisResult>
  >;

  registry.registerPath({
    method: "get",
    path: "/api/v1/overview-analysis",
    tags: ["Analytics"],
    summary: "Get the stored Overview chart analysis",
    description: "The last generated per-chart reading for the Overview tab, without spending AI.",
    security: common.security,
    request: { query: overviewAnalysisQuerySchema },
    responses: {
      200: {
        description: "The stored analysis, or `sections: null`",
        content: { "application/json": { schema: OverviewAnalysis } },
      },
      ...common.validationError('`range` is neither a day count from 1 to 366 nor "all"'),
      ...common.authenticatedResponses(),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/overview-analysis",
    tags: ["Analytics"],
    summary: "Regenerate the Overview chart analysis",
    description:
      "Runs the AI reading of the Overview charts for `range` now and stores it (replacing any other range's). Can take tens of seconds. Rate limited to 3 per window.",
    security: common.security,
    request: { query: overviewAnalysisQuerySchema },
    responses: {
      200: {
        description: "The fresh analysis",
        content: { "application/json": { schema: OverviewAnalysisResultSchema } },
      },
      ...common.validationError('`range` is neither a day count from 1 to 366 nor "all"'),
      ...common.error(
        500,
        "INTERNAL_SERVER_ERROR: the AI reply was unusable, or the AI provider was unreachable",
      ),
      ...common.error(502, "EXTERNAL_API_ERROR: the AI provider returned an error"),
      ...common.authenticatedResponses(),
      ...aiGateResponses(common),
    },
  });
}
