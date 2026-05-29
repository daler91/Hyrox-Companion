import { parseExercisesFromImageRequestSchema } from "@shared/schema";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, sendNotFound, validateBody, validateParams } from "../../routeUtils";
import { batchReparseWorkoutsUseCase, reparseWorkoutFromImageUseCase, reparseWorkoutUseCase } from "../../services/parseWorkoutUseCases";
import { storage } from "../../storage";
import { getUserId } from "../../types";
import { protectedPost } from "../_helpers/protectedRouteBuilder";
import { reparseWorkoutParamsSchema, reparseWorkoutRouteSchema } from "./shared";

// Shared 422 body for a reparse that produced no persisted exercise sets.
const PARSE_WRITE_THROUGH_ERROR = {
  error: "Parsing did not produce persisted exercise sets.",
  code: "PARSE_WRITE_THROUGH_REQUIRED",
} as const;

export function registerWorkoutAiRoutes(router: Router): void {
  router.get("/api/v1/workouts/unstructured", isAuthenticated, rateLimiter("workoutList", 60), asyncHandler(async (req: Request, res) => {
    const userId = getUserId(req);
    const workouts = await storage.workouts.getWorkoutsWithoutExerciseSets(userId);
    res.json(workouts);
  }));

  protectedPost(router, "/api/v1/workouts/:id/reparse", { limiter: rateLimiter("reparse", 5), aiConsent: true, aiBudget: true, validation: [validateParams(reparseWorkoutParamsSchema), validateBody(reparseWorkoutRouteSchema)] }, async (req: Request<{ id: string }, unknown, z.infer<typeof reparseWorkoutRouteSchema>>, res: Response) => {
    const outcome = await reparseWorkoutUseCase({ userId: getUserId(req), workoutId: req.params.id, payload: req.body });
    if (outcome.status === "not_found") return sendNotFound(res, "Workout not found");
    if (outcome.status === "parse_failed") return res.status(422).json(PARSE_WRITE_THROUGH_ERROR);
    res.json(outcome.response);
  });

  protectedPost(router, "/api/v1/workouts/:id/reparse-from-image", { limiter: rateLimiter("reparse", 5), aiConsent: true, aiBudget: true, validation: [validateBody(parseExercisesFromImageRequestSchema)] }, async (req: Request<{ id: string }, unknown, z.infer<typeof parseExercisesFromImageRequestSchema>>, res: Response) => {
    const outcome = await reparseWorkoutFromImageUseCase({ userId: getUserId(req), workoutId: req.params.id, image: req.body });
    if (outcome.status === "not_found") return sendNotFound(res, "Workout not found");
    if (outcome.status === "parse_failed") return res.status(422).json(PARSE_WRITE_THROUGH_ERROR);
    res.json(outcome.response);
  });

  protectedPost(router, "/api/v1/workouts/batch-reparse", { limiter: rateLimiter("batchReparse", 2), aiConsent: true, aiBudget: true }, async (req: Request, res: Response) => {
    res.json(await batchReparseWorkoutsUseCase({ userId: getUserId(req) }));
  });
}
