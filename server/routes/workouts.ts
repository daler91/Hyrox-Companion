import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { rateLimiter, handleRouteError } from "../routeUtils";
import { storage } from "../storage";
import { insertWorkoutLogSchema, updateWorkoutLogSchema, insertCustomExerciseSchema, exercisesPayloadSchema } from "@shared/schema";
import { generateCSV, generateJSON } from "../services/exportService";
import { createWorkout, updateWorkout, reparseWorkout, prepareParsedWorkout, saveParsedWorkout } from "../services/workoutService";
import { getUserId, AuthenticatedRequest } from "../types";

const router = Router();

router.get("/api/workouts/unstructured", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const workouts = await storage.getWorkoutsWithoutExerciseSets(userId);
    res.json(workouts);
  } catch (error) {
    handleRouteError(res, error, "Failed to fetch workouts");
  }
});

router.post("/api/workouts/:id/reparse", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
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
  } catch (error) {
    handleRouteError(res, error, "Failed to re-parse workout");
  }
});

async function processBatchChunk(
  chunk: any[],
  weightUnit: string
): Promise<{ parsed: number; failed: number }> {
  let parsed = 0;
  let failed = 0;

  // Parse workouts concurrently in chunks to optimize AI service usage
  const chunkResults = await Promise.allSettled(
    chunk.map(workout => prepareParsedWorkout(workout, weightUnit))
  );

  // Save each successfully parsed workout sequentially to prevent DB connection strain
  for (let j = 0; j < chunkResults.length; j++) {
    const result = chunkResults[j];
    const workout = chunk[j];

    if (result.status === 'rejected') {
      console.error(`Batch reparse failed for workout ${workout.id}:`, result.reason);
      failed++;
      continue;
    }

    if (!result.value) {
      failed++;
      continue;
    }

    try {
      await saveParsedWorkout(workout.id, result.value.setRows);
      parsed++;
    } catch (dbError) {
      console.error(`Failed to save re-parsed workout ${workout.id}:`, dbError);
      failed++;
    }
  }

  return { parsed, failed };
}

router.post("/api/workouts/batch-reparse", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const workouts = await storage.getWorkoutsWithoutExerciseSets(userId);
    const user = await storage.getUser(userId);
    const weightUnit = user?.weightUnit || "kg";

    let totalParsed = 0;
    let totalFailed = 0;

    // Process workouts concurrently in chunks to improve performance
    // while preventing overload of the Gemini AI service and database
    const CONCURRENCY_LIMIT = 5;
    for (let i = 0; i < workouts.length; i += CONCURRENCY_LIMIT) {
      const chunk = workouts.slice(i, i + CONCURRENCY_LIMIT);
      const { parsed, failed } = await processBatchChunk(chunk, weightUnit);
      totalParsed += parsed;
      totalFailed += failed;
    }
    res.json({ total: workouts.length, parsed: totalParsed, failed: totalFailed });
  } catch (error) {
    handleRouteError(res, error, "Failed to batch re-parse workouts");
  }
});

router.get("/api/custom-exercises", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const exercises = await storage.getCustomExercises(userId);
    res.json(exercises);
  } catch (error) {
    handleRouteError(res, error, "Failed to fetch custom exercises");
  }
});

router.post("/api/custom-exercises", isAuthenticated, rateLimiter("customExercise", 20), async (req: AuthenticatedRequest, res) => {
  try {
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
  } catch (error) {
    handleRouteError(res, error, "Failed to save custom exercise");
  }
});

router.get("/api/workouts", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const logs = await storage.listWorkoutLogs(userId);
    res.json(logs);
  } catch (error) {
    handleRouteError(res, error, "Failed to list workouts");
  }
});

router.get("/api/workouts/:id", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const log = await storage.getWorkoutLog(req.params.id, userId);
    if (!log) {
      return res.status(404).json({ error: "Workout not found" });
    }
    res.json(log);
  } catch (error) {
    handleRouteError(res, error, "Failed to get workout");
  }
});

router.post("/api/workouts", isAuthenticated, rateLimiter("workout", 40), async (req: AuthenticatedRequest, res) => {
  try {
    const { exercises, ...workoutData } = req.body;
    const parseResult = insertWorkoutLogSchema.safeParse(workoutData);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid workout data", details: parseResult.error });
    }

    let validatedExercises = exercises;
    if (exercises) {
      const exercisesParseResult = exercisesPayloadSchema.safeParse(exercises);
      if (!exercisesParseResult.success) {
        return res.status(400).json({ error: "Invalid exercises data", details: exercisesParseResult.error });
      }
      validatedExercises = exercisesParseResult.data;
    }

    const userId = getUserId(req);
    const result = await createWorkout(parseResult.data, validatedExercises, userId);
    res.json(result);
  } catch (error) {
    handleRouteError(res, error, "Failed to create workout");
  }
});

router.patch("/api/workouts/:id", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const { exercises, ...updateData } = req.body;
    const parseResult = updateWorkoutLogSchema.safeParse(updateData);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid update data", details: parseResult.error });
    }

    let validatedExercises = exercises;
    if (exercises) {
      const exercisesParseResult = exercisesPayloadSchema.safeParse(exercises);
      if (!exercisesParseResult.success) {
        return res.status(400).json({ error: "Invalid exercises data", details: exercisesParseResult.error });
      }
      validatedExercises = exercisesParseResult.data;
    }

    const userId = getUserId(req);
    const result = await updateWorkout(req.params.id, parseResult.data, validatedExercises, userId);
    if (!result) {
      return res.status(404).json({ error: "Workout not found" });
    }

    res.json(result);
  } catch (error) {
    handleRouteError(res, error, "Failed to update workout");
  }
});

router.delete("/api/workouts/:id", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    await storage.deleteExerciseSetsByWorkoutLog(req.params.id, userId);
    const deleted = await storage.deleteWorkoutLog(req.params.id, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Workout not found" });
    }
    res.json({ success: true });
  } catch (error) {
    handleRouteError(res, error, "Failed to delete workout");
  }
});

router.get("/api/exercises/:exerciseName/history", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const history = await storage.getExerciseHistory(userId, req.params.exerciseName);
    res.json(history);
  } catch (error) {
    handleRouteError(res, error, "Failed to get exercise history");
  }
});

router.get("/api/timeline", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const planId = req.query.planId as string | undefined;
    const entries = await storage.getTimeline(userId, planId);
    res.json(entries);
  } catch (error) {
    handleRouteError(res, error, "Failed to get timeline");
  }
});

router.get("/api/export", isAuthenticated, rateLimiter("export", 5, 60000), async (req: AuthenticatedRequest, res) => {
  try {
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
  } catch (error) {
    handleRouteError(res, error, "Failed to export data");
  }
});

export default router;
