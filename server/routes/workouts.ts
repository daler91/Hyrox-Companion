import { Router, type Request, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { rateLimiter, asyncHandler } from "../routeUtils";
import { storage } from "../storage";
import { insertWorkoutLogSchema, updateWorkoutLogSchema, insertCustomExerciseSchema, type InsertWorkoutLog, type UpdateWorkoutLog, type InsertCustomExercise , type ParsedExercise} from "@shared/schema";
import { generateCSV, generateJSON } from "../services/exportService";
import { createWorkout, updateWorkout, reparseWorkout, batchReparseWorkouts, validateExercisesPayload } from "../services/workoutService";
import { getUserId } from "../types";
import { queue } from "../queue";

const router = Router();

router.get("/api/v1/workouts/unstructured", isAuthenticated, asyncHandler(async (req: Request, res) => {
    const userId = getUserId(req);
    const workouts = await storage.getWorkoutsWithoutExerciseSets(userId);
    res.json(workouts);
  }));

router.post("/api/v1/workouts/:id/reparse", isAuthenticated, rateLimiter("reparse", 5), asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    const workoutId = req.params.id;
    const workout = await storage.getWorkoutLog(workoutId, userId);
    if (!workout) {
      return res.status(404).json({ error: "Workout not found" });
    }
    const user = await storage.getUser(userId);
    const weightUnit = user?.weightUnit || "kg";
    const result = await reparseWorkout(workout, weightUnit);
    if (!result) {
      return res.json({ exercises: [], saved: false });
    }
    res.json({ exercises: result.exercises, saved: true, setCount: result.setCount });
  }));


router.post("/api/v1/workouts/batch-reparse", isAuthenticated, rateLimiter("batchReparse", 2), asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { total, parsed, failed } = await batchReparseWorkouts(userId);
    res.json({ total, parsed, failed });
  }));

router.get("/api/v1/custom-exercises", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const exercises = await storage.getCustomExercises(userId);
    res.json(exercises);
  }));

router.post("/api/v1/custom-exercises", isAuthenticated, rateLimiter("customExercise", 20), asyncHandler(async (req: Request<Record<string, never>, Record<string, never>, InsertCustomExercise & { userId?: string }>, res: Response) => {
    const userId = getUserId(req);

    // Add default userId to body for safeParse if needed by schema, though we override it below
    const payload = { ...req.body, userId };
    const parseResult = insertCustomExerciseSchema.safeParse(payload);

    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }

    const { name, category } = parseResult.data;

    const exercise = await storage.upsertCustomExercise({
      userId,
      name: name.trim(),
      category: category || "conditioning",
    });
    res.json(exercise);
  }));

router.get("/api/v1/workouts", isAuthenticated, asyncHandler(async (req: Request<Record<string, never>, Record<string, never>, Record<string, never>, { limit?: string; offset?: string }>, res: Response) => {
    const userId = getUserId(req);
    const limit = req.query.limit ? Number.parseInt(req.query.limit) : undefined;
    const offset = req.query.offset ? Number.parseInt(req.query.offset) : undefined;

    if (limit !== undefined && Number.isNaN(limit)) return res.status(400).json({ error: "Invalid limit" });
    if (offset !== undefined && Number.isNaN(offset)) return res.status(400).json({ error: "Invalid offset" });

    const logs = await storage.listWorkoutLogs(userId, limit, offset);
    res.json(logs);
  }));

router.get("/api/v1/workouts/:id", isAuthenticated, asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    const log = await storage.getWorkoutLog(req.params.id, userId);
    if (!log) {
      return res.status(404).json({ error: "Workout not found" });
    }
    res.json(log);
  }));

router.post("/api/v1/workouts", isAuthenticated, rateLimiter("workout", 40), asyncHandler(async (req: Request<Record<string, never>, Record<string, never>, InsertWorkoutLog & { exercises?: ParsedExercise[] }>, res: Response) => {
    const { exercises, ...workoutData } = req.body;
    const parseResult = insertWorkoutLogSchema.safeParse(workoutData);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid workout data", details: parseResult.error });
    }

    const exerciseValidation = validateExercisesPayload(exercises);
    if (!exerciseValidation.success) {
      return res.status(400).json({ error: "Invalid exercises data", details: exerciseValidation.error });
    }
    const validatedExercises = exerciseValidation.data as ParsedExercise[] | undefined;

    const userId = getUserId(req);
    const result = await createWorkout(parseResult.data, validatedExercises, userId);
    res.json(result);
    // Queue job: auto-coach adjusts upcoming plan days based on this completed workout
    await queue.send("auto-coach", { userId });
  }));

router.patch("/api/v1/workouts/:id", isAuthenticated, rateLimiter("workout", 40), asyncHandler(async (req: Request<{ id: string }, Record<string, never>, UpdateWorkoutLog & { exercises?: ParsedExercise[] }>, res: Response) => {
    const { exercises, ...updateData } = req.body;
    const parseResult = updateWorkoutLogSchema.safeParse(updateData);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid update data", details: parseResult.error });
    }

    const exerciseValidation = validateExercisesPayload(exercises);
    if (!exerciseValidation.success) {
      return res.status(400).json({ error: "Invalid exercises data", details: exerciseValidation.error });
    }
    const validatedExercises = exerciseValidation.data as ParsedExercise[] | undefined;

    const userId = getUserId(req);
    const result = await updateWorkout(req.params.id, parseResult.data, validatedExercises, userId);
    if (!result) {
      return res.status(404).json({ error: "Workout not found" });
    }

    res.json(result);
  }));

router.delete("/api/v1/workouts/:id", isAuthenticated, rateLimiter("workout", 40), asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    await storage.deleteExerciseSetsByWorkoutLog(req.params.id, userId);
    const deleted = await storage.deleteWorkoutLog(req.params.id, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Workout not found" });
    }
    res.json({ success: true });
  }));

router.get("/api/v1/exercises/:exerciseName/history", isAuthenticated, asyncHandler(async (req: Request<{ exerciseName: string }>, res: Response) => {
    const userId = getUserId(req);
    const history = await storage.getExerciseHistory(userId, req.params.exerciseName);
    res.json(history);
  }));

router.get("/api/v1/timeline", isAuthenticated, asyncHandler(async (req: Request<Record<string, never>, Record<string, never>, Record<string, never>, { planId?: string; limit?: string; offset?: string }>, res: Response) => {
    const userId = getUserId(req);
    const planId = req.query.planId;
    const limit = req.query.limit ? Number.parseInt(req.query.limit) : undefined;
    const offset = req.query.offset ? Number.parseInt(req.query.offset) : undefined;

    if (limit !== undefined && Number.isNaN(limit)) return res.status(400).json({ error: "Invalid limit" });
    if (offset !== undefined && Number.isNaN(offset)) return res.status(400).json({ error: "Invalid offset" });

    const entries = await storage.getTimeline(userId, planId, limit, offset);
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
