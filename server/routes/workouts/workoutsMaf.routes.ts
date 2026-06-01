import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, sendNotFound, validateBody } from "../../routeUtils";
import { recordMafTestFromWorkout } from "../../services/mafTestService";
import { storage } from "../../storage";
import { getUserId } from "../../types";
import { protectedDelete, protectedPost } from "../_helpers/protectedRouteBuilder";

const mafTestBodySchema = z.object({
  protocolType: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
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
