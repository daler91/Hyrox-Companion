import { computeMafCompliance } from "@shared/maf";

import { AppError, ErrorCode } from "../errors";
import { storage } from "../storage";
import type { InsertMafWorkoutAnalysis, MafTestResult, MafWorkoutAnalysis } from "../storage/mafTests";

export interface MafTestRecord {
  testResult: MafTestResult;
  analysis: MafWorkoutAnalysis | null;
  /** False when this workout was already tagged and the existing record was returned. */
  created: boolean;
}

function inferProtocolType(workout: { duration: number | null }): string {
  return workout.duration != null && workout.duration > 0 ? "fixed_time_run" : "maf_test";
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
  opts?: { protocolType?: string; notes?: string },
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
  // untouched. (A DB unique constraint would also close the rare simultaneous
  // double-submit race, but workoutLogId lives in the conditions JSONB; this
  // read-check covers the realistic cases without a schema migration.)
  const existing = await storage.mafTests.getTestResultByWorkoutLogId(userId, workout.id);
  if (existing) {
    const existingAnalysis = await storage.mafTests.getWorkoutAnalysisByWorkoutLogId(userId, workout.id);
    return { testResult: existing, analysis: existingAnalysis ?? null, created: false };
  }

  const ceiling = user.mafHr;

  // Compliance scoring needs the average HR; compute an analysis row only when
  // HR data is present so it can be written together with the test below.
  let analysisData: InsertMafWorkoutAnalysis | null = null;
  if (workout.avgHeartrate != null) {
    const compliance = computeMafCompliance({
      avgHeartRate: workout.avgHeartrate,
      maxHeartRate: workout.maxHeartrate,
      ceiling,
    });
    analysisData = {
      userId,
      workoutLogId: workout.id,
      compliancePct: compliance.compliancePct,
      classification: compliance.classification,
      nextAction: compliance.nextAction,
      analysisDetails: compliance.details,
    };
  }

  // Write the test and its analysis atomically so a tagged workout never lands
  // in a partial state (test row but no analysis) that a later idempotent
  // re-tag would return as-is, dropping it from the trend (Codex P2).
  const { testResult, analysis } = await storage.mafTests.createTestWithAnalysis(
    {
      userId,
      protocolType: opts?.protocolType?.trim() || inferProtocolType(workout),
      conditions: { source: "tagged_workout", workoutLogId: workout.id },
      metrics: {
        durationSeconds: workout.duration ?? null,
        avgHeartRate: workout.avgHeartrate ?? null,
        maxHeartRate: workout.maxHeartrate ?? null,
        mafCeilingUsed: ceiling,
      },
      notes: opts?.notes?.trim() || null,
    },
    analysisData,
  );

  return { testResult, analysis, created: true };
}
