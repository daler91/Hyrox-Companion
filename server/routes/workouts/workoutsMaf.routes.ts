import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, sendNotFound, validateBody } from "../../routeUtils";
import { recordMafTestFromWorkout, updateMafTestForWorkout } from "../../services/mafTestService";
import { storage } from "../../storage";
import { getUserId } from "../../types";
import { protectedDelete, protectedPatch, protectedPost } from "../_helpers/protectedRouteBuilder";

// Manual metric corrections. All optional/nullable: an omitted field keeps the
// auto-pulled (or previously stored) value, an explicit null clears it. Bounds
// mirror the manual-metrics validation in the client workout form.
const mafTestMetricsSchema = z
  .object({
    avgHeartRate: z.number().int().min(20).max(250).nullable().optional(),
    maxHeartRate: z.number().int().min(20).max(250).nullable().optional(),
    durationSeconds: z.number().int().positive().max(86_400).nullable().optional(),
    distanceMeters: z.number().nonnegative().max(1_000_000).nullable().optional(),
  })
  .refine(
    (m) => m.avgHeartRate == null || m.maxHeartRate == null || m.maxHeartRate >= m.avgHeartRate,
    { message: "Max heart rate can't be lower than average heart rate." },
  );

const mafTestBodySchema = z.object({
  protocolType: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  metrics: mafTestMetricsSchema.optional(),
});

export function registerWorkoutMafRoutes(router: Router): void {
  // Tag an already-logged run as a MAF test: records a maf_test_results row and,
  // when the run has HR data, a maf_workout_analysis compliance row.
  protectedPost(
    router,
    "/api/v1/workouts/:id/maf-test",
    { limiter: rateLimiter("mafTest", 20), middleware: [validateBody(mafTestBodySchema)] },
    async (req: Request<{ id: string }, unknown, z.infer<typeof mafTestBodySchema>>, res: Response) => {
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
    async (req: Request<{ id: string }, unknown, z.infer<typeof mafTestBodySchema>>, res: Response) => {
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
      const [tests, analysis] = await Promise.all([
        storage.mafTests.listTestResults(userId),
        storage.mafTests.listWorkoutAnalysis(userId),
      ]);
      res.json({ tests, analysis });
    }),
  );
}
