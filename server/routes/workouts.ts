import { logger } from "../logger";
import { Router, type Request } from "express";
import { isAuthenticated } from "../clerkAuth";
import { rateLimiter } from "../routeUtils";
import { storage } from "../storage";
import { insertWorkoutLogSchema, updateWorkoutLogSchema, insertCustomExerciseSchema, exercisesPayloadSchema } from "@shared/schema";
import { generateCSV, generateJSON } from "../services/exportService";
import { createWorkout, updateWorkout, reparseWorkout, prepareParsedWorkout, saveParsedWorkout } from "../services/workoutService";
import { getUserId } from "../types";

const router = Router();

router.get("/api/v1/workouts/unstructured", isAuthenticated, async (req: Request, res) => {
  try {
    const userId = getUserId(req);
    const workouts = await storage.getWorkoutsWithoutExerciseSets(userId);
    res.json(workouts);
  } catch (error) {
    logger.error({ err: error }, "Error fetching unstructured workouts:");
    res.status(500).json({ error: "Failed to fetch workouts" });
  }
});

router.post("/api/v1/workouts/:id/reparse", isAuthenticated, async (req: Request, res) => {
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
    logger.error({ err: error }, "Error re-parsing workout:");
    res.status(500).json({ error: "Failed to re-parse workout" });
  }
});

async function processBatchChunk(
  chunk: { id: string; mainWorkout?: string | null; accessory?: string | null }[],
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
      logger.error({ err: result.reason }, `Batch reparse failed for workout ${workout.id}:`);
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
      logger.error({ err: dbError }, `Failed to save re-parsed workout ${workout.id}:`);
      failed++;
    }
  }

  return { parsed, failed };
}

function validateExercisesPayload(exercises: any) {
  if (!exercises) return { success: true, data: exercises };
  const parseResult = exercisesPayloadSchema.safeParse(exercises);
  if (!parseResult.success) {
    return { success: false, error: parseResult.error };
  }
  return { success: true, data: parseResult.data };
}

router.post("/api/v1/workouts/batch-reparse", isAuthenticated, async (req: Request, res) => {
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
    logger.error({ err: error }, "Batch reparse error:");
    res.status(500).json({ error: "Failed to batch re-parse workouts" });
  }
});

router.get("/api/v1/custom-exercises", isAuthenticated, async (req: Request, res) => {
  try {
    const userId = getUserId(req);
    const exercises = await storage.getCustomExercises(userId);
    res.json(exercises);
  } catch (error) {
    logger.error({ err: error }, "Error fetching custom exercises:");
    res.status(500).json({ error: "Failed to fetch custom exercises" });
  }
});

router.post("/api/v1/custom-exercises", isAuthenticated, rateLimiter("customExercise", 20), async (req: Request, res) => {
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
    logger.error({ err: error }, "Error saving custom exercise:");
    res.status(500).json({ error: "Failed to save custom exercise" });
  }
});

router.get("/api/v1/workouts", isAuthenticated, async (req: Request, res) => {
  try {
    const userId = getUserId(req);
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

    if (limit !== undefined && isNaN(limit)) return res.status(400).json({ error: "Invalid limit" });
    if (offset !== undefined && isNaN(offset)) return res.status(400).json({ error: "Invalid offset" });

    const logs = await storage.listWorkoutLogs(userId, limit, offset);
    res.json(logs);
  } catch (error) {
    logger.error({ err: error }, "List workouts error:");
    res.status(500).json({ error: "Failed to list workouts" });
  }
});

router.get("/api/v1/workouts/:id", isAuthenticated, async (req: Request, res) => {
  try {
    const userId = getUserId(req);
    const log = await storage.getWorkoutLog(req.params.id, userId);
    if (!log) {
      return res.status(404).json({ error: "Workout not found" });
    }
    res.json(log);
  } catch (error) {
    logger.error({ err: error }, "Get workout error:");
    res.status(500).json({ error: "Failed to get workout" });
  }
});

router.post("/api/v1/workouts", isAuthenticated, rateLimiter("workout", 40), async (req: Request, res) => {
  try {
    const { exercises, ...workoutData } = req.body;
    const parseResult = insertWorkoutLogSchema.safeParse(workoutData);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid workout data", details: parseResult.error });
    }

    const exerciseValidation = validateExercisesPayload(exercises);
    if (!exerciseValidation.success) {
      return res.status(400).json({ error: "Invalid exercises data", details: exerciseValidation.error });
    }
    const validatedExercises = exerciseValidation.data;

    const userId = getUserId(req);
    const result = await createWorkout(parseResult.data, validatedExercises, userId);
    res.json(result);
  } catch (error) {
    logger.error({ err: error }, "Create workout error:");
    res.status(500).json({ error: "Failed to create workout" });
  }
});

router.patch("/api/v1/workouts/:id", isAuthenticated, async (req: Request, res) => {
  try {
    const { exercises, ...updateData } = req.body;
    const parseResult = updateWorkoutLogSchema.safeParse(updateData);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid update data", details: parseResult.error });
    }

    const exerciseValidation = validateExercisesPayload(exercises);
    if (!exerciseValidation.success) {
      return res.status(400).json({ error: "Invalid exercises data", details: exerciseValidation.error });
    }
    const validatedExercises = exerciseValidation.data;

    const userId = getUserId(req);
    const result = await updateWorkout(req.params.id, parseResult.data, validatedExercises, userId);
    if (!result) {
      return res.status(404).json({ error: "Workout not found" });
    }

    res.json(result);
  } catch (error) {
    logger.error({ err: error }, "Update workout error:");
    res.status(500).json({ error: "Failed to update workout" });
  }
});

router.delete("/api/v1/workouts/:id", isAuthenticated, async (req: Request, res) => {
  try {
    const userId = getUserId(req);
    await storage.deleteExerciseSetsByWorkoutLog(req.params.id, userId);
    const deleted = await storage.deleteWorkoutLog(req.params.id, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Workout not found" });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Delete workout error:");
    res.status(500).json({ error: "Failed to delete workout" });
  }
});

router.get("/api/v1/exercises/:exerciseName/history", isAuthenticated, async (req: Request, res) => {
  try {
    const userId = getUserId(req);
    const history = await storage.getExerciseHistory(userId, req.params.exerciseName);
    res.json(history);
  } catch (error) {
    logger.error({ err: error }, "Exercise history error:");
    res.status(500).json({ error: "Failed to get exercise history" });
  }
});

router.get("/api/v1/timeline", isAuthenticated, async (req: Request, res) => {
  try {
    const userId = getUserId(req);
    const planId = req.query.planId as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

    if (limit !== undefined && isNaN(limit)) return res.status(400).json({ error: "Invalid limit" });
    if (offset !== undefined && isNaN(offset)) return res.status(400).json({ error: "Invalid offset" });

    const entries = await storage.getTimeline(userId, planId, limit, offset);
    res.json(entries);
  } catch (error) {
    logger.error({ err: error }, "Timeline error:");
    res.status(500).json({ error: "Failed to get timeline" });
  }
});

router.get("/api/v1/export", isAuthenticated, rateLimiter("export", 5, 60000), async (req: Request, res) => {
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
    logger.error({ err: error }, "Export error:");
    res.status(500).json({ error: "Failed to export data" });
  }
});

export default router;
