import { exercisesPayloadSchema,insertCustomExerciseSchema, insertWorkoutLogSchema, planDays, trainingPlans, updateWorkoutLogSchema, workoutLogs } from "@shared/schema";
import { and,eq, inArray } from "drizzle-orm";
import { type Request, type Response,Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../clerkAuth";
import { DEFAULT_PAGE_LIMIT, DEFAULT_TIMELINE_LIMIT, MAX_PAGE_LIMIT } from "../constants";
import { db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { protectedMutationGuards } from "../routeGuards";
import { asyncHandler, rateLimiter, validateBody } from "../routeUtils";
import { generateCSV, generateJSON } from "../services/exportService";
import { batchReparseWorkouts,reparseWorkout } from "../services/workoutService";
import { createWorkout, updateWorkoutUseCase } from "../services/workoutUseCases";
import { storage } from "../storage";
import { getUserId } from "../types";

// Route schemas — combine core table schema with the optional exercises payload
// so a single validateBody() middleware covers both in one pass and emits a
// uniform VALIDATION_ERROR contract (CODEBASE_AUDIT.md §1).
const createWorkoutRouteSchema = insertWorkoutLogSchema.extend({
  exercises: exercisesPayloadSchema.optional(),
});
const updateWorkoutRouteSchema = updateWorkoutLogSchema.extend({
  exercises: exercisesPayloadSchema.optional(),
});
type CreateWorkoutRoutePayload = z.infer<typeof createWorkoutRouteSchema>;
type UpdateWorkoutRoutePayload = z.infer<typeof updateWorkoutRouteSchema>;

// Custom-exercise endpoint now uses the shared `validateBody` middleware
// for a uniform VALIDATION_ERROR contract (CODEBASE_AUDIT.md §4). The table
// schema carries `userId` but clients never supply it — it's injected from
// the authenticated session — so omit it from the request schema.
const createCustomExerciseSchema = insertCustomExerciseSchema.omit({ userId: true });
type CreateCustomExercisePayload = z.infer<typeof createCustomExerciseSchema>;

const router = Router();

router.get("/api/v1/workouts/unstructured", isAuthenticated, rateLimiter("workoutList", 60), asyncHandler(async (req: Request, res) => {
    const userId = getUserId(req);
    const workouts = await storage.workouts.getWorkoutsWithoutExerciseSets(userId);
    res.json(workouts);
  }));

router.post("/api/v1/workouts/:id/reparse", ...protectedMutationGuards, rateLimiter("reparse", 5), asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    const workoutId = req.params.id;
    // ⚡ Perf: Parallelize independent DB queries — getWorkoutLog and getUser
    // don't depend on each other, so run them concurrently to halve latency.
    const [workout, user] = await Promise.all([
      storage.workouts.getWorkoutLog(workoutId, userId),
      storage.users.getUser(userId),
    ]);
    if (!workout) {
      return res.status(404).json({ error: "Workout not found", code: "NOT_FOUND" });
    }
    const weightUnit = user?.weightUnit || "kg";
    const result = await reparseWorkout(workout, weightUnit);
    if (!result) {
      return res.json({ exercises: [], saved: false });
    }
    res.json({ exercises: result.exercises, saved: true, setCount: result.setCount });
  }));


router.post("/api/v1/workouts/batch-reparse", ...protectedMutationGuards, rateLimiter("batchReparse", 2), asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { total, parsed, failed } = await batchReparseWorkouts(userId);
    res.json({ total, parsed, failed });
  }));

router.get("/api/v1/custom-exercises", isAuthenticated, rateLimiter("customExercise", 60), asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const exercises = await storage.users.getCustomExercises(userId);
    res.json(exercises);
  }));

router.post("/api/v1/custom-exercises", ...protectedMutationGuards, rateLimiter("customExercise", 20), validateBody(createCustomExerciseSchema), asyncHandler(async (req: Request<Record<string, never>, Record<string, never>, CreateCustomExercisePayload>, res: Response) => {
    const userId = getUserId(req);
    const { name, category } = req.body;
    const exercise = await storage.users.upsertCustomExercise({
      userId,
      name: name.trim(),
      category: category || "conditioning",
    });
    res.json(exercise);
  }));

router.get("/api/v1/workouts", isAuthenticated, rateLimiter("workoutList", 60), asyncHandler(async (req: Request<Record<string, never>, Record<string, never>, Record<string, never>, { limit?: string; offset?: string }>, res: Response) => {
    const userId = getUserId(req);
    const rawLimit = req.query.limit ? Number.parseInt(req.query.limit, 10) : DEFAULT_PAGE_LIMIT;
    const offset = req.query.offset ? Number.parseInt(req.query.offset, 10) : undefined;

    if (Number.isNaN(rawLimit) || rawLimit < 1) return res.status(400).json({ error: "Invalid limit", code: "BAD_REQUEST" });
    if (offset !== undefined && (Number.isNaN(offset) || offset < 0)) return res.status(400).json({ error: "Invalid offset", code: "BAD_REQUEST" });
    // Reject rather than silently clamp so clients that rely on the full page
    // size don't render incomplete results without noticing (S1).
    if (rawLimit > MAX_PAGE_LIMIT) {
      return res.status(412).json({
        error: `limit exceeds maximum of ${MAX_PAGE_LIMIT}`,
        code: "PRECONDITION_FAILED",
        maxLimit: MAX_PAGE_LIMIT,
      });
    }

    const limit = rawLimit;
    const logs = await storage.workouts.listWorkoutLogs(userId, limit, offset);
    res.json(logs);
  }));

// Returns the most recent workout log for the authenticated user WITH its
// exercise sets eagerly loaded, so the client can hydrate a "Duplicate last
// workout" prefill on the Log Workout page without a second round-trip.
// Deliberately registered BEFORE the :id route below so Express matches
// "/latest" as a literal path rather than an id parameter.
router.get("/api/v1/workouts/latest", isAuthenticated, rateLimiter("workout", 60), asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const [latest] = await storage.workouts.listWorkoutLogs(userId, 1);
    if (!latest) {
      return res.status(404).json({ error: "No workouts found", code: "NOT_FOUND" });
    }
    const exerciseSets = await storage.workouts.getExerciseSetsByWorkoutLog(latest.id);
    res.json({ ...latest, exerciseSets });
  }));

router.get("/api/v1/workouts/:id", isAuthenticated, rateLimiter("workout", 60), asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    const log = await storage.workouts.getWorkoutLog(req.params.id, userId);
    if (!log) {
      return res.status(404).json({ error: "Workout not found", code: "NOT_FOUND" });
    }
    res.json(log);
  }));

router.post("/api/v1/workouts", ...protectedMutationGuards, rateLimiter("workout", 40), validateBody(createWorkoutRouteSchema), asyncHandler(async (req: Request<Record<string, never>, Record<string, never>, CreateWorkoutRoutePayload>, res: Response) => {
    const userId = getUserId(req);
    const result = await createWorkout({ userId, payload: req.body });
    res.json(result);
  }));

router.patch("/api/v1/workouts/:id", ...protectedMutationGuards, rateLimiter("workout", 40), validateBody(updateWorkoutRouteSchema), asyncHandler(async (req: Request<{ id: string }, Record<string, never>, UpdateWorkoutRoutePayload>, res: Response) => {
    const userId = getUserId(req);
    const result = await updateWorkoutUseCase({ userId, workoutId: req.params.id, payload: req.body });
    if (!result) {
      return res.status(404).json({ error: "Workout not found", code: "NOT_FOUND" });
    }

    res.json(result);
  }));

router.delete("/api/v1/workouts/:id", ...protectedMutationGuards, rateLimiter("workout", 40), asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    // exercise_sets are cleaned up by FK ON DELETE CASCADE — no need to
    // delete them explicitly (avoids a non-atomic two-step delete).
    const deleted = await storage.workouts.deleteWorkoutLog(req.params.id, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Workout not found", code: "NOT_FOUND" });
    }
    res.json({ success: true });
  }));

// Combine two workouts into one atomically: creates a new workout and
// deletes the originals in a single DB transaction so partial failures
// cannot leave duplicate data (code review finding QA-C1).
const combineWorkoutsSchema = z.object({
  newWorkout: insertWorkoutLogSchema,
  deleteWorkoutIds: z.array(z.string().min(1)).min(1).max(10),
  skipPlanDayIds: z.array(z.string().min(1)).max(10).optional(),
});

router.post("/api/v1/workouts/combine", ...protectedMutationGuards, rateLimiter("workout", 10), validateBody(combineWorkoutsSchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { newWorkout, deleteWorkoutIds, skipPlanDayIds } = req.body as z.infer<typeof combineWorkoutsSchema>;

    const result = await db.transaction(async (tx) => {
      // Guard against combining unrelated plan-day workouts: any source
      // workout's planDayId must either match the new combined workout's
      // planDayId OR appear in skipPlanDayIds. Prevents silently detaching
      // a workout from its plan day by merging it into a different one.
      const sourceWorkouts = await tx
        .select({ id: workoutLogs.id, planDayId: workoutLogs.planDayId })
        .from(workoutLogs)
        .where(and(inArray(workoutLogs.id, deleteWorkoutIds), eq(workoutLogs.userId, userId)));

      if (sourceWorkouts.length !== deleteWorkoutIds.length) {
        throw new AppError(ErrorCode.NOT_FOUND, "One or more source workouts not found", 404);
      }

      const keptPlanDayId = newWorkout.planDayId ?? null;

      // Ownership check on the kept plan day — without this, a caller can
      // pin the combined row to another tenant's planDayId (IDOR).
      if (keptPlanDayId) {
        const ownedKeptDay = await tx
          .select({ id: planDays.id })
          .from(planDays)
          .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
          .where(and(eq(planDays.id, keptPlanDayId), eq(trainingPlans.userId, userId)))
          .limit(1);
        if (ownedKeptDay.length === 0) {
          throw new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404);
        }
      }

      // Drop the kept plan day from the skip list — otherwise the combined
      // workout's own plan day would immediately be marked skipped below.
      const skipIds = (skipPlanDayIds ?? []).filter((id) => id !== keptPlanDayId);

      const allowedPlanDayIds = new Set<string>(skipIds);
      if (keptPlanDayId) allowedPlanDayIds.add(keptPlanDayId);

      for (const src of sourceWorkouts) {
        if (src.planDayId && !allowedPlanDayIds.has(src.planDayId)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Cannot combine: source workout ${src.id} is linked to plan day ${src.planDayId}, which isn't the kept plan day or in skipPlanDayIds.`,
            400,
          );
        }
      }

      // Create the combined workout
      const [created] = await tx.insert(workoutLogs).values({
        ...newWorkout,
        userId,
      }).returning();

      // Delete the original workouts (FK cascade removes exercise_sets)
      for (const id of deleteWorkoutIds) {
        await tx.delete(workoutLogs).where(and(eq(workoutLogs.id, id), eq(workoutLogs.userId, userId)));
      }

      // Mark associated plan days as skipped — scoped to plans owned by
      // the requesting user to prevent IDOR writes on other tenants' data.
      if (skipIds.length) {
        const userPlanIds = tx
          .select({ id: trainingPlans.id })
          .from(trainingPlans)
          .where(eq(trainingPlans.userId, userId));

        await tx.update(planDays)
          .set({ status: "skipped" })
          .where(and(
            inArray(planDays.id, skipIds),
            inArray(planDays.planId, userPlanIds),
          ));
      }

      return created;
    });

    res.status(201).json(result);
  }));

router.get("/api/v1/exercises/:exerciseName/history", isAuthenticated, rateLimiter("workoutHistory", 60), asyncHandler(async (req: Request<{ exerciseName: string }>, res: Response) => {
    const userId = getUserId(req);
    const history = await storage.workouts.getExerciseHistory(userId, req.params.exerciseName);
    res.json(history);
  }));

router.get("/api/v1/timeline", isAuthenticated, rateLimiter("timeline", 60), asyncHandler(async (req: Request<Record<string, never>, Record<string, never>, Record<string, never>, { planId?: string; limit?: string; offset?: string }>, res: Response) => {
    const userId = getUserId(req);
    const planId = req.query.planId;
    const rawLimit = req.query.limit ? Number.parseInt(req.query.limit, 10) : DEFAULT_TIMELINE_LIMIT;
    const offset = req.query.offset ? Number.parseInt(req.query.offset, 10) : undefined;

    if (Number.isNaN(rawLimit) || rawLimit < 1) return res.status(400).json({ error: "Invalid limit", code: "BAD_REQUEST" });
    if (offset !== undefined && (Number.isNaN(offset) || offset < 0)) return res.status(400).json({ error: "Invalid offset", code: "BAD_REQUEST" });

    const limit = Math.min(rawLimit, DEFAULT_TIMELINE_LIMIT);
    const entries = await storage.timeline.getTimeline(userId, planId, limit, offset);
    res.json(entries);
  }));

router.get("/api/v1/export", isAuthenticated, rateLimiter("export", 5, 60000), asyncHandler(async (req: Request<Record<string, never>, Record<string, never>, Record<string, never>, { format?: string }>, res: Response) => {
    const userId = getUserId(req);
    const format = (req.query.format as string) || "csv";

    if (format === "json") {
      const data = await generateJSON(userId, storage);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=hyrox-training-data.json");
      return res.json(data);
    }

    const csv = await generateCSV(userId, storage);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=hyrox-training-data.csv");
    res.send(csv);
  }));

export default router;
