import {
  type AddExerciseSetBody,
  addExerciseSetBodySchema,
  insertWorkoutLogSchema,
  type PatchExerciseSetBody,
  patchExerciseSetBodySchema,
  planDays,
  trainingPlans,
  workoutLogs,
} from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../../clerkAuth";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../../constants";
import { db } from "../../db";
import { AppError, ErrorCode } from "../../errors";
import { protectedMutationGuards } from "../../routeGuards";
import { asyncHandler, parsePagination, rateLimiter, sendNotFound, validateBody } from "../../routeUtils";
import { createWorkout, updateWorkoutUseCase } from "../../services/workoutUseCases";
import { storage } from "../../storage";
import { getUserId } from "../../types";
import { createMutateExerciseSetByOwnerUseCase } from "../../usecases/workouts/mutateExerciseSetByOwner.usecase";
import { protectedPost } from "../_helpers/protectedRouteBuilder";
import { createCustomExerciseSchema, createWorkoutRouteSchema, updateWorkoutRouteSchema } from "./shared";

const patchExerciseSetSchema = patchExerciseSetBodySchema;
const addExerciseSetSchema = addExerciseSetBodySchema;
const WORKOUT_NOT_FOUND = "Workout not found";
const EXERCISE_SET_NOT_FOUND = "Exercise set not found";

const workoutSetUseCase = createMutateExerciseSetByOwnerUseCase(storage.workouts);

const combineWorkoutsSchema = z.object({
  newWorkout: insertWorkoutLogSchema,
  deleteWorkoutIds: z.array(z.string().min(1)).min(1).max(10),
  skipPlanDayIds: z.array(z.string().min(1)).max(10).optional(),
});

export function registerWorkoutCrudRoutes(router: Router): void {
  router.get("/api/v1/custom-exercises", isAuthenticated, rateLimiter("customExercise", 60), asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const exercises = await storage.users.getCustomExercises(userId);
    res.json(exercises);
  }));

  protectedPost(router, "/api/v1/custom-exercises", { limiter: rateLimiter("customExercise", 20), middleware: [validateBody(createCustomExerciseSchema)] }, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { name, category } = req.body as { name: string; category?: string };
    const exercise = await storage.users.upsertCustomExercise({ userId, name: name.trim(), category: category || "conditioning" });
    res.json(exercise);
  });

  router.get("/api/v1/workouts", isAuthenticated, rateLimiter("workoutList", 60), asyncHandler(async (req: Request<Record<string, never>, Record<string, never>, Record<string, never>, { limit?: string; offset?: string }>, res: Response) => {
    const userId = getUserId(req);
    const pagination = parsePagination(req.query, res, { defaultLimit: DEFAULT_PAGE_LIMIT, maxLimit: MAX_PAGE_LIMIT });
    if (!pagination) {
      return;
    }
    const logs = await storage.workouts.listWorkoutLogs(userId, pagination.limit, pagination.offset);
    res.json(logs);
  }));

  router.get("/api/v1/workouts/latest", isAuthenticated, rateLimiter("workout", 60), asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const [latest] = await storage.workouts.listWorkoutLogs(userId, 1);
    if (!latest) {
      return sendNotFound(res, "No workouts found");
    }
    const exerciseSets = await storage.workouts.getExerciseSetsByWorkoutLog(latest.id);
    res.json({ ...latest, exerciseSets });
  }));

  router.patch("/api/v1/workouts/:id/sets/:setId", ...protectedMutationGuards, rateLimiter("workoutSet", 120), validateBody(patchExerciseSetSchema), asyncHandler(async (req: Request<{ id: string; setId: string }, Record<string, never>, PatchExerciseSetBody>, res: Response) => {
    const updated = await workoutSetUseCase.updateSet({ kind: "workoutLog", id: req.params.id }, req.params.setId, req.body, getUserId(req));
    if (!updated) {
      return sendNotFound(res, EXERCISE_SET_NOT_FOUND);
    }
    res.json(updated);
  }));

  router.post("/api/v1/workouts/:id/sets", ...protectedMutationGuards, rateLimiter("workoutSet", 60), validateBody(addExerciseSetSchema), asyncHandler(async (req: Request<{ id: string }, Record<string, never>, AddExerciseSetBody>, res: Response) => {
    const created = await workoutSetUseCase.addSet({ kind: "workoutLog", id: req.params.id }, req.body, getUserId(req));
    if (!created) {
      return sendNotFound(res, WORKOUT_NOT_FOUND);
    }
    res.status(201).json(created);
  }));

  router.delete("/api/v1/workouts/:id/sets/:setId", ...protectedMutationGuards, rateLimiter("workoutSet", 60), asyncHandler(async (req: Request<{ id: string; setId: string }>, res: Response) => {
    const deleted = await workoutSetUseCase.deleteSet({ kind: "workoutLog", id: req.params.id }, req.params.setId, getUserId(req));
    if (!deleted) {
      return sendNotFound(res, EXERCISE_SET_NOT_FOUND);
    }
    res.json({ success: true });
  }));

  router.get("/api/v1/workouts/:id/history", isAuthenticated, rateLimiter("workoutHistory", 60), asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const stats = await storage.workouts.getWorkoutHistoryStats(req.params.id, getUserId(req));
    if (!stats) {
      return sendNotFound(res, WORKOUT_NOT_FOUND);
    }
    res.json(stats);
  }));

  router.post("/api/v1/workouts/:id/seed-from-plan", ...protectedMutationGuards, rateLimiter("workoutSet", 20), asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const seeded = await storage.workouts.seedExerciseSetsFromPlanDay(req.params.id, getUserId(req));
    res.json({ seededCount: seeded });
  }));

  router.get("/api/v1/workouts/:id", isAuthenticated, rateLimiter("workout", 60), asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const log = await storage.workouts.getWorkoutLog(req.params.id, getUserId(req));
    if (!log) {
      return sendNotFound(res, WORKOUT_NOT_FOUND);
    }
    const exerciseSets = await storage.workouts.getExerciseSetsByWorkoutLog(log.id);
    res.json({ ...log, exerciseSets });
  }));

  protectedPost(router, "/api/v1/workouts", { limiter: rateLimiter("workout", 40), middleware: [validateBody(createWorkoutRouteSchema)] }, async (req: Request, res: Response) => {
    const result = await createWorkout({ userId: getUserId(req), payload: req.body as never });
    res.json(result);
  });

  router.patch("/api/v1/workouts/:id", ...protectedMutationGuards, rateLimiter("workout", 40), validateBody(updateWorkoutRouteSchema), asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const result = await updateWorkoutUseCase({ userId: getUserId(req), workoutId: req.params.id, payload: req.body as never });
    if (!result) {
      return sendNotFound(res, WORKOUT_NOT_FOUND);
    }
    res.json(result);
  }));

  router.delete("/api/v1/workouts/:id", ...protectedMutationGuards, rateLimiter("workout", 40), asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const deleted = await storage.workouts.deleteWorkoutLog(req.params.id, getUserId(req));
    if (!deleted) {
      return sendNotFound(res, WORKOUT_NOT_FOUND);
    }
    res.json({ success: true });
  }));

  router.post("/api/v1/workouts/combine", ...protectedMutationGuards, rateLimiter("workout", 10), validateBody(combineWorkoutsSchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { newWorkout, deleteWorkoutIds, skipPlanDayIds } = req.body as z.infer<typeof combineWorkoutsSchema>;

    const result = await db.transaction(async (tx) => {
      const sourceWorkouts = await tx.select({ id: workoutLogs.id, planDayId: workoutLogs.planDayId }).from(workoutLogs).where(and(inArray(workoutLogs.id, deleteWorkoutIds), eq(workoutLogs.userId, userId)));
      if (sourceWorkouts.length !== deleteWorkoutIds.length) {
        throw new AppError(ErrorCode.NOT_FOUND, "One or more source workouts not found", 404);
      }

      const keptPlanDayId = newWorkout.planDayId ?? null;
      if (keptPlanDayId) {
        const owned = await tx.select({ id: planDays.id }).from(planDays).innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id)).where(and(eq(planDays.id, keptPlanDayId), eq(trainingPlans.userId, userId))).limit(1);
        if (owned.length === 0) {
          throw new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404);
        }
      }

      const skipIds = (skipPlanDayIds ?? []).filter((id) => id !== keptPlanDayId);
      const allowed = new Set<string>(skipIds);
      if (keptPlanDayId) {
        allowed.add(keptPlanDayId);
      }

      for (const src of sourceWorkouts) {
        if (src.planDayId && !allowed.has(src.planDayId)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Cannot combine: source workout ${src.id} is linked to plan day ${src.planDayId}, which isn't the kept plan day or in skipPlanDayIds.`,
            400,
          );
        }
      }

      const [created] = await tx.insert(workoutLogs).values({ ...newWorkout, userId }).returning();
      for (const id of deleteWorkoutIds) {
        await tx.delete(workoutLogs).where(and(eq(workoutLogs.id, id), eq(workoutLogs.userId, userId)));
      }

      if (skipIds.length) {
        const userPlanIds = tx.select({ id: trainingPlans.id }).from(trainingPlans).where(eq(trainingPlans.userId, userId));
        await tx.update(planDays).set({ status: "skipped" }).where(and(inArray(planDays.id, skipIds), inArray(planDays.planId, userPlanIds)));
      }

      return created;
    });

    res.status(201).json(result);
  }));

  router.get("/api/v1/exercises/:exerciseName/history", isAuthenticated, rateLimiter("workoutHistory", 60), asyncHandler(async (req: Request<{ exerciseName: string }>, res: Response) => {
    const history = await storage.workouts.getExerciseHistory(getUserId(req), req.params.exerciseName);
    res.json(history);
  }));
}
