import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { insertWorkoutLogSchema, updateWorkoutLogSchema } from "@shared/schema";
import { generateCSV, generateJSON } from "../services/exportService";
import { createWorkout, updateWorkout, reparseWorkout } from "../services/workoutService";
import { getUserId } from "../types";

const router = Router();

router.get("/api/workouts/unstructured", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const workouts = await storage.getWorkoutsWithoutExerciseSets(userId);
    res.json(workouts);
  } catch (error) {
    console.error("Error fetching unstructured workouts:", error);
    res.status(500).json({ error: "Failed to fetch workouts" });
  }
});

router.post("/api/workouts/:id/reparse", isAuthenticated, async (req: any, res) => {
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
    console.error("Error re-parsing workout:", error);
    res.status(500).json({ error: "Failed to re-parse workout" });
  }
});

router.post("/api/workouts/batch-reparse", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const workouts = await storage.getWorkoutsWithoutExerciseSets(userId);
    const user = await storage.getUser(userId);
    const weightUnit = user?.weightUnit || "kg";

    let parsed = 0;
    let failed = 0;
    for (const workout of workouts) {
      try {
        const result = await reparseWorkout(workout, weightUnit);
        if (result) {
          parsed++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(`Batch reparse failed for workout ${workout.id}:`, error);
        failed++;
      }
    }
    res.json({ total: workouts.length, parsed, failed });
  } catch (error) {
    console.error("Batch reparse error:", error);
    res.status(500).json({ error: "Failed to batch re-parse workouts" });
  }
});

router.get("/api/custom-exercises", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const exercises = await storage.getCustomExercises(userId);
    res.json(exercises);
  } catch (error) {
    console.error("Error fetching custom exercises:", error);
    res.status(500).json({ error: "Failed to fetch custom exercises" });
  }
});

router.post("/api/custom-exercises", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const { name, category } = req.body as { name: string; category?: string };
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    const exercise = await storage.upsertCustomExercise({
      userId,
      name: name.trim(),
      category: category || "conditioning",
    });
    res.json(exercise);
  } catch (error) {
    console.error("Error saving custom exercise:", error);
    res.status(500).json({ error: "Failed to save custom exercise" });
  }
});

router.get("/api/workouts", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const logs = await storage.listWorkoutLogs(userId);
    res.json(logs);
  } catch (error) {
    console.error("List workouts error:", error);
    res.status(500).json({ error: "Failed to list workouts" });
  }
});

router.get("/api/workouts/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const log = await storage.getWorkoutLog(req.params.id, userId);
    if (!log) {
      return res.status(404).json({ error: "Workout not found" });
    }
    res.json(log);
  } catch (error) {
    console.error("Get workout error:", error);
    res.status(500).json({ error: "Failed to get workout" });
  }
});

router.post("/api/workouts", isAuthenticated, async (req: any, res) => {
  try {
    const { exercises, ...workoutData } = req.body;
    const parseResult = insertWorkoutLogSchema.safeParse(workoutData);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid workout data", details: parseResult.error });
    }

    const userId = getUserId(req);
    const result = await createWorkout(parseResult.data, exercises, userId);
    res.json(result);
  } catch (error) {
    console.error("Create workout error:", error);
    res.status(500).json({ error: "Failed to create workout" });
  }
});

router.patch("/api/workouts/:id", isAuthenticated, async (req: any, res) => {
  try {
    const { exercises, ...updateData } = req.body;
    const parseResult = updateWorkoutLogSchema.safeParse(updateData);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid update data", details: parseResult.error });
    }

    const userId = getUserId(req);
    const result = await updateWorkout(req.params.id, parseResult.data, exercises, userId);
    if (!result) {
      return res.status(404).json({ error: "Workout not found" });
    }

    res.json(result);
  } catch (error) {
    console.error("Update workout error:", error);
    res.status(500).json({ error: "Failed to update workout" });
  }
});

router.delete("/api/workouts/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    await storage.deleteExerciseSetsByWorkoutLog(req.params.id, userId);
    const deleted = await storage.deleteWorkoutLog(req.params.id, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Workout not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Delete workout error:", error);
    res.status(500).json({ error: "Failed to delete workout" });
  }
});

router.get("/api/exercises/:exerciseName/history", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const history = await storage.getExerciseHistory(userId, req.params.exerciseName);
    res.json(history);
  } catch (error) {
    console.error("Exercise history error:", error);
    res.status(500).json({ error: "Failed to get exercise history" });
  }
});

router.get("/api/timeline", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const planId = req.query.planId as string | undefined;
    const entries = await storage.getTimeline(userId, planId);
    res.json(entries);
  } catch (error) {
    console.error("Timeline error:", error);
    res.status(500).json({ error: "Failed to get timeline" });
  }
});

router.get("/api/export", isAuthenticated, async (req: any, res) => {
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
    console.error("Export error:", error);
    res.status(500).json({ error: "Failed to export data" });
  }
});

export default router;
