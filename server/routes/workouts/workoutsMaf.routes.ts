import { type MafTestBody, mafTestBodySchema } from "@shared/schema/types/workoutsRequests";
import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, sendNotFound, validateBody } from "../../routeUtils";
import { recordMafTestFromWorkout, updateMafTestForWorkout } from "../../services/mafTestService";
import { storage } from "../../storage";
import type { MafTestResult, MafWorkoutAnalysis } from "../../storage/mafTests";
import { getUserId } from "../../types";
import { protectedDelete, protectedPatch, protectedPost } from "../_helpers/protectedRouteBuilder";

/** Rows of MAF history returned to the trend charts. */
const MAF_HISTORY_LIMIT = 200;

/**
 * Every workout the listed history points at: a test keeps its `workoutLogId`
 * inside the `conditions` JSONB, an analysis row as a column.
 */
function taggedWorkoutLogIds(
  tests: readonly MafTestResult[],
  analysis: readonly MafWorkoutAnalysis[],
): string[] {
  const ids = new Set<string>();
  for (const test of tests) {
    const workoutLogId = (test.conditions as { workoutLogId?: unknown } | null)?.workoutLogId;
    if (typeof workoutLogId === "string") ids.add(workoutLogId);
  }
  for (const row of analysis) {
    if (row.workoutLogId) ids.add(row.workoutLogId);
  }
  return [...ids];
}

export function registerWorkoutMafRoutes(router: Router): void {
  // Tag an already-logged run as a MAF test: records a maf_test_results row and,
  // when the run has HR data, a maf_workout_analysis compliance row.
  protectedPost(
    router,
    "/api/v1/workouts/:id/maf-test",
    { limiter: rateLimiter("mafTest", 20), middleware: [validateBody(mafTestBodySchema)] },
    async (req: Request<{ id: string }, unknown, MafTestBody>, res: Response) => {
      const userId = getUserId(req);
      const { created, ...record } = await recordMafTestFromWorkout(userId, req.params.id, req.body);
      // 201 on first tag; 200 when an already-tagged workout is returned idempotently.
      res.status(created ? 201 : 200).json(record);
    },
  );

  // Edit an already-tagged MAF test: apply manual HR / duration / distance
  // corrections and recompute the compliance analysis against the athlete's
  // current ceiling. 404 when the workout wasn't tagged.
  protectedPatch(
    router,
    "/api/v1/workouts/:id/maf-test",
    { limiter: rateLimiter("mafTest", 20), middleware: [validateBody(mafTestBodySchema)] },
    async (req: Request<{ id: string }, unknown, MafTestBody>, res: Response) => {
      const userId = getUserId(req);
      const { testResult, analysis } = await updateMafTestForWorkout(userId, req.params.id, req.body);
      res.json({ testResult, analysis });
    },
  );

  // Untag a workout: remove its MAF test (and compliance analysis) so an
  // accidental tag can be undone from the workout review surface. 404 when the
  // workout wasn't tagged.
  protectedDelete(
    router,
    "/api/v1/workouts/:id/maf-test",
    { limiter: rateLimiter("mafTest", 20) },
    async (req: Request<{ id: string }>, res: Response) => {
      const deleted = await storage.mafTests.deleteTestForWorkout(getUserId(req), req.params.id);
      if (!deleted) return sendNotFound(res, "MAF test not found");
      res.json({ success: true });
    },
  );

  // MAF test history + compliance trend (for the coach and the UI).
  router.get(
    "/api/v1/maf-tests",
    isAuthenticated,
    rateLimiter("mafTest", 60),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = getUserId(req);
      // Explicit, and wider than the old silent default of 20 — which quietly
      // cut both trend charts off at twenty points (audit M14).
      const [tests, analysis] = await Promise.all([
        storage.mafTests.listTestResults(userId, MAF_HISTORY_LIMIT),
        storage.mafTests.listWorkoutAnalysis(userId, MAF_HISTORY_LIMIT),
      ]);
      // The charts date each test by its workout, not by when it was tagged
      // (CL4 (CODEBASE_ANALYSIS_2026-10-03)).
      const workoutDates = await storage.mafTests.getWorkoutDates(
        userId,
        taggedWorkoutLogIds(tests, analysis),
      );
      res.json({ tests, analysis, workoutDates });
    }),
  );
}
