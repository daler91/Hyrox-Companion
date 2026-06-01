import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, validateBody } from "../../routeUtils";
import { recordMafTestFromWorkout } from "../../services/mafTestService";
import { storage } from "../../storage";
import { getUserId } from "../../types";
import { protectedPost } from "../_helpers/protectedRouteBuilder";

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
