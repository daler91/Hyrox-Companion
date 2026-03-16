import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { rateLimiter , handleError } from "../routeUtils";
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
    handleError(res, error, "Error fetching unstructured workouts:", "Failed to fetch workouts", 500);
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
    handleError(res, error, "Error re-parsing workout:", "Failed to re-parse workout", 500);
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
    handleError(res, error, "Batch reparse error:", "Failed to batch re-parse workouts", 500);
  }
});

router.get("/api/custom-exercises", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const exercises = await storage.getCustomExercises(userId);
    res.json(exercises);
  } catch (error) {
    handleError(res, error, "Error fetching custom exercises:", "Failed to fetch custom exercises", 500);
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
    handleError(res, error, "Error saving custom exercise:", "Failed to save custom exercise", 500);
  }
});

router.get("/api/workouts", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const logs = await storage.listWorkoutLogs(userId);
    res.json(logs);
  } catch (error) {
    handleError(res, error, "List workouts error:", "Failed to list workouts", 500);
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
    handleError(res, error, "Get workout error:", "Failed to get workout", 500);
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
    handleError(res, error, "Create workout error:", "Failed to create workout", 500);
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
    handleError(res, error, "Update workout error:", "Failed to update workout", 500);
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
    handleError(res, error, "Delete workout error:", "Failed to delete workout", 500);
  }
});

router.get("/api/exercises/:exerciseName/history", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const history = await storage.getExerciseHistory(userId, req.params.exerciseName);
    res.json(history);
  } catch (error) {
    handleError(res, error, "Exercise history error:", "Failed to get exercise history", 500);
  }
});

router.get("/api/timeline", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const planId = req.query.planId as string | undefined;
    const entries = await storage.getTimeline(userId, planId);
    res.json(entries);
  } catch (error) {
    handleError(res, error, "Timeline error:", "Failed to get timeline", 500);
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
    handleError(res, error, "Export error:", "Failed to export data", 500);
  }
});

export default router;
