import { parseExercisesFromImageRequestSchema, updateWorkoutLogSchema } from "@shared/schema";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../../clerkAuth";
import { aiBudgetCheck } from "../../middleware/aibudget";
import { protectedMutationGuards } from "../../routeGuards";
import { asyncHandler, rateLimiter, sendNotFound, validateBody, validateParams } from "../../routeUtils";
import { batchReparseWorkouts, reparseWorkout, reparseWorkoutFromImage } from "../../services/workoutService";
import { storage } from "../../storage";
import { getUserId } from "../../types";
import { protectedPost } from "../_helpers/protectedRouteBuilder";
import { reparseWorkoutParamsSchema, reparseWorkoutRouteSchema } from "./shared";

export function registerWorkoutAiRoutes(router: Router): void {
  router.get("/api/v1/workouts/unstructured", isAuthenticated, rateLimiter("workoutList", 60), asyncHandler(async (req: Request, res) => {
    const userId = getUserId(req);
    const workouts = await storage.workouts.getWorkoutsWithoutExerciseSets(userId);
    res.json(workouts);
  }));
  router.post("/api/v1/workouts/:id/reparse", ...protectedMutationGuards, rateLimiter("reparse", 5), aiBudgetCheck, validateParams(reparseWorkoutParamsSchema), validateBody(reparseWorkoutRouteSchema), asyncHandler(async (req: Request<{ id: string }, unknown, z.infer<typeof reparseWorkoutRouteSchema>>, res: Response) => {
    const userId = getUserId(req);
    const workoutId = req.params.id;
    const [workout, user] = await Promise.all([storage.workouts.getWorkoutLog(workoutId, userId), storage.users.getUser(userId)]);
    if (!workout) return sendNotFound(res, "Workout not found");
    const weightUnit = user?.weightUnit || "kg";
    const referencePatch: Partial<z.infer<typeof updateWorkoutLogSchema>> = {};
    const parseTarget: { id: string; mainWorkout?: string | null; accessory?: string | null } = { id: workout.id, mainWorkout: workout.prescribedMainWorkout ?? workout.mainWorkout, accessory: workout.prescribedAccessory ?? workout.accessory };
    if (req.body.prescribedMainWorkout !== undefined) { referencePatch.prescribedMainWorkout = req.body.prescribedMainWorkout; parseTarget.mainWorkout = req.body.prescribedMainWorkout; }
    if (req.body.prescribedAccessory !== undefined) { referencePatch.prescribedAccessory = req.body.prescribedAccessory; parseTarget.accessory = req.body.prescribedAccessory; }
    if (Object.keys(referencePatch).length > 0) await storage.workouts.updateWorkoutLog(workoutId, referencePatch, userId);
    const result = await reparseWorkout(parseTarget, weightUnit);
    if (!result) return res.json({ exercises: [], saved: false });
    res.json({ exercises: result.exercises, saved: true, setCount: result.setCount });
  }));
  router.post("/api/v1/workouts/:id/reparse-from-image", ...protectedMutationGuards, rateLimiter("reparse", 5), aiBudgetCheck, validateBody(parseExercisesFromImageRequestSchema), asyncHandler(async (req: Request<{ id: string }, unknown, z.infer<typeof parseExercisesFromImageRequestSchema>>, res: Response) => {
    const userId = getUserId(req);
    const [workout, user, customExercises] = await Promise.all([storage.workouts.getWorkoutLog(req.params.id, userId), storage.users.getUser(userId), storage.users.getCustomExercises(userId)]);
    if (!workout) return sendNotFound(res, "Workout not found");
    const result = await reparseWorkoutFromImage(workout, req.body, user?.weightUnit || "kg", userId, customExercises.map((e) => e.name));
    if (!result) return res.json({ exercises: [], saved: false });
    res.json({ exercises: result.exercises, saved: true, setCount: result.setCount });
  }));
  protectedPost(router, "/api/v1/workouts/batch-reparse", { limiter: rateLimiter("batchReparse", 2), middleware: [aiBudgetCheck] }, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { total, parsed, failed } = await batchReparseWorkouts(userId);
    res.json({ total, parsed, failed });
  });
}
