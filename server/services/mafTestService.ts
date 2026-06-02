import { computeMafCompliance, type MafTestMetrics } from "@shared/maf";

import { AppError, ErrorCode } from "../errors";
import { storage } from "../storage";
import type { InsertMafWorkoutAnalysis, MafTestResult, MafWorkoutAnalysis } from "../storage/mafTests";

export interface MafTestRecord {
  testResult: MafTestResult;
  analysis: MafWorkoutAnalysis | null;
  /** False when this workout was already tagged and the existing record was returned. */
  created: boolean;
}

/**
 * Manually-entered metrics that override the values auto-pulled from the workout
 * (or, on edit, the test's stored values). A field set to `null` deliberately
 * clears the value; an omitted (`undefined`) field falls back to the base.
 */
export interface MafTestManualInput {
  avgHeartRate?: number | null;
  maxHeartRate?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
}

interface MafMetricsBase {
  durationSeconds: number | null;
  distanceMeters: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
}

function inferProtocolType(durationSeconds: number | null): string {
  return durationSeconds != null && durationSeconds > 0 ? "fixed_time_run" : "maf_test";
}

/** An explicit override (including a deliberate `null` clear) wins; an omitted field keeps the base. */
function pickMetric(override: number | null | undefined, base: number | null): number | null {
  return override !== undefined ? override : base;
}

/**
 * Merge manually-entered metrics over a base snapshot (the workout on create,
 * the existing test on edit) and, when an effective average HR results, score it
 * against the athlete's current MAF ceiling. A manual avg HR therefore produces a
 * compliance row even for a run synced without heart-rate data.
 */
function buildMetricsAndAnalysis(
  userId: string,
  workoutLogId: string,
  base: MafMetricsBase,
  ceiling: number,
  manual: MafTestManualInput | undefined,
): { metrics: MafTestMetrics; analysisData: InsertMafWorkoutAnalysis | null } {
  const avgHeartRate = pickMetric(manual?.avgHeartRate, base.avgHeartRate);
  const maxHeartRate = pickMetric(manual?.maxHeartRate, base.maxHeartRate);
  const durationSeconds = pickMetric(manual?.durationSeconds, base.durationSeconds);
  const distanceMeters = pickMetric(manual?.distanceMeters, base.distanceMeters);

  const metrics: MafTestMetrics = {
    durationSeconds,
    distanceMeters,
    avgHeartRate,
    maxHeartRate,
    mafCeilingUsed: ceiling,
  };

  let analysisData: InsertMafWorkoutAnalysis | null = null;
  if (avgHeartRate != null) {
    const compliance = computeMafCompliance({ avgHeartRate, maxHeartRate, ceiling });
    analysisData = {
      userId,
      workoutLogId,
      compliancePct: compliance.compliancePct,
      classification: compliance.classification,
      nextAction: compliance.nextAction,
      analysisDetails: compliance.details,
    };
  }

  return { metrics, analysisData };
}

/**
 * Record a logged run as a MAF test: persist a `maf_test_results` row from the
 * workout's metrics and, when the workout carries heart-rate data, a
 * `maf_workout_analysis` row scoring it against the athlete's MAF ceiling.
 * Requires the athlete to be on the MAF Method style with a computed ceiling.
 */
export async function recordMafTestFromWorkout(
  userId: string,
  workoutId: string,
  opts?: { protocolType?: string; notes?: string; metrics?: MafTestManualInput },
): Promise<MafTestRecord> {
  const user = await storage.users.getUser(userId);
  if (!user) throw new AppError(ErrorCode.NOT_FOUND, "User not found", 404);
  if (user.trainingStyleId !== "maf_method" || user.mafHr == null) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "Set up the MAF Method training style (which computes your heart-rate ceiling) before logging a MAF test.",
      400,
    );
  }

  const workout = await storage.workouts.getWorkoutLog(workoutId, userId);
  if (!workout) throw new AppError(ErrorCode.NOT_FOUND, "Workout not found", 404);

  // Idempotency (Codex P2): tagging the same workout twice — a double-click,
  // a client retry, or the athlete revisiting the action — must not append
  // duplicate test/analysis rows that would double-count the effort in the MAF
  // trend. If this workout is already tagged, return the existing record
  // untouched; manual corrections after the first tag go through
  // updateMafTestForWorkout (the PATCH route), not a re-POST. (A DB unique
  // constraint would also close the rare simultaneous double-submit race, but
  // workoutLogId lives in the conditions JSONB; this read-check covers the
  // realistic cases without a schema migration.)
  const existing = await storage.mafTests.getTestResultByWorkoutLogId(userId, workout.id);
  if (existing) {
    const existingAnalysis = await storage.mafTests.getWorkoutAnalysisByWorkoutLogId(userId, workout.id);
    return { testResult: existing, analysis: existingAnalysis ?? null, created: false };
  }

  const ceiling = user.mafHr;
  // Manual entries (when the form provides them) override the workout's values;
  // with no manual input this preserves the auto-pull-from-workout behavior.
  const { metrics, analysisData } = buildMetricsAndAnalysis(
    userId,
    workout.id,
    {
      durationSeconds: workout.duration ?? null,
      distanceMeters: workout.distanceMeters ?? null,
      avgHeartRate: workout.avgHeartrate ?? null,
      maxHeartRate: workout.maxHeartrate ?? null,
    },
    ceiling,
    opts?.metrics,
  );

  // Write the test and its analysis atomically so a tagged workout never lands
  // in a partial state (test row but no analysis) that a later idempotent
  // re-tag would return as-is, dropping it from the trend (Codex P2).
  const { testResult, analysis } = await storage.mafTests.createTestWithAnalysis(
    {
      userId,
      protocolType: opts?.protocolType?.trim() || inferProtocolType(metrics.durationSeconds),
      conditions: { source: "tagged_workout", workoutLogId: workout.id },
      metrics,
      notes: opts?.notes?.trim() || null,
    },
    analysisData,
  );

  return { testResult, analysis, created: true };
}

/**
 * Update the metrics of an already-tagged MAF test (manual HR / duration /
 * distance corrections from the workout review surface) and recompute its
 * compliance analysis against the athlete's current MAF ceiling. Omitted metric
 * fields keep their stored value; clearing the average HR drops the compliance
 * row. 404s when the workout isn't tagged.
 */
export async function updateMafTestForWorkout(
  userId: string,
  workoutId: string,
  opts: { protocolType?: string; notes?: string; metrics?: MafTestManualInput },
): Promise<MafTestRecord> {
  const user = await storage.users.getUser(userId);
  if (!user) throw new AppError(ErrorCode.NOT_FOUND, "User not found", 404);
  if (user.trainingStyleId !== "maf_method" || user.mafHr == null) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "Set up the MAF Method training style (which computes your heart-rate ceiling) before editing a MAF test.",
      400,
    );
  }

  const existing = await storage.mafTests.getTestResultByWorkoutLogId(userId, workoutId);
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "MAF test not found", 404);

  const ceiling = user.mafHr;
  const base: Partial<MafTestMetrics> | null = existing.metrics ?? null;
  const { metrics, analysisData } = buildMetricsAndAnalysis(
    userId,
    workoutId,
    {
      durationSeconds: base?.durationSeconds ?? null,
      distanceMeters: base?.distanceMeters ?? null,
      avgHeartRate: base?.avgHeartRate ?? null,
      maxHeartRate: base?.maxHeartRate ?? null,
    },
    ceiling,
    opts.metrics,
  );

  const { testResult, analysis } = await storage.mafTests.updateTestWithAnalysis(
    userId,
    workoutId,
    {
      metrics,
      // Keep the protocol consistent with the (possibly edited) duration unless
      // an explicit value is supplied.
      protocolType: opts.protocolType?.trim() || inferProtocolType(metrics.durationSeconds),
      ...(opts.notes !== undefined ? { notes: opts.notes.trim() || null } : {}),
    },
    analysisData,
  );

  return { testResult, analysis, created: false };
}
