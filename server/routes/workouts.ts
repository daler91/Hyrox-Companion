import { Router } from "express";
import { isAuthenticated } from "../replitAuth";
import { storage } from "../storage";
import { insertWorkoutLogSchema, updateWorkoutLogSchema } from "@shared/schema";
import { expandExercisesToSetRows } from "../routeUtils";
import { parseExercisesFromText } from "../gemini";

const router = Router();

router.get("/api/workouts/unstructured", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    const workouts = await storage.getWorkoutsWithoutExerciseSets(userId);
    res.json(workouts);
  } catch (error) {
    console.error("Error fetching unstructured workouts:", error);
    res.status(500).json({ error: "Failed to fetch workouts" });
  }
});

router.post("/api/workouts/:id/reparse", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    const workoutId = req.params.id;
    const workout = await storage.getWorkoutLog(workoutId, userId);
    if (!workout) {
      return res.status(404).json({ error: "Workout not found" });
    }
    const textToParse = [workout.mainWorkout, workout.accessory].filter(Boolean).join("\n");
    if (!textToParse.trim()) {
      return res.status(400).json({ error: "No text to parse" });
    }
    const user = await storage.getUser(userId);
    const weightUnit = user?.weightUnit || "kg";
    const exercises = await parseExercisesFromText(textToParse.trim(), weightUnit);
    if (exercises.length === 0) {
      return res.json({ exercises: [], saved: false });
    }
    const setRows = expandExercisesToSetRows(exercises, workoutId);
    await storage.deleteExerciseSetsByWorkoutLog(workoutId);
    await storage.createExerciseSets(setRows);
    res.json({ exercises, saved: true, setCount: setRows.length });
  } catch (error) {
    console.error("Error re-parsing workout:", error);
    res.status(500).json({ error: "Failed to re-parse workout" });
  }
});

router.post("/api/workouts/batch-reparse", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    const workouts = await storage.getWorkoutsWithoutExerciseSets(userId);
    const user = await storage.getUser(userId);
    const weightUnit = user?.weightUnit || "kg";

    let parsed = 0;
    let failed = 0;
    for (const workout of workouts) {
      try {
        const textToParse = [workout.mainWorkout, workout.accessory].filter(Boolean).join("\n");
        if (!textToParse.trim()) { failed++; continue; }
        const exercises = await parseExercisesFromText(textToParse.trim(), weightUnit);
        if (exercises.length === 0) { failed++; continue; }
        const setRows = expandExercisesToSetRows(exercises, workout.id);
        await storage.createExerciseSets(setRows);
        parsed++;
      } catch {
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
    const userId = req.user.claims.sub;
    const exercises = await storage.getCustomExercises(userId);
    res.json(exercises);
  } catch (error) {
    console.error("Error fetching custom exercises:", error);
    res.status(500).json({ error: "Failed to fetch custom exercises" });
  }
});

router.post("/api/custom-exercises", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
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
    const userId = req.user.claims.sub;
    const logs = await storage.listWorkoutLogs(userId);
    res.json(logs);
  } catch (error) {
    console.error("List workouts error:", error);
    res.status(500).json({ error: "Failed to list workouts" });
  }
});

router.get("/api/workouts/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
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

    const userId = req.user.claims.sub;
    const log = await storage.createWorkoutLog({ ...parseResult.data, userId });

    if (exercises && Array.isArray(exercises) && exercises.length > 0) {
      const exerciseSetData = expandExercisesToSetRows(exercises, log.id);
      const savedSets = await storage.createExerciseSets(exerciseSetData);

      for (const ex of exercises) {
        if (ex.exerciseName === "custom" && ex.customLabel) {
          await storage.upsertCustomExercise({ userId, name: ex.customLabel, category: ex.category || "conditioning" });
        }
      }

      return res.json({ ...log, exerciseSets: savedSets });
    }

    res.json(log);
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

    const userId = req.user.claims.sub;
    const log = await storage.updateWorkoutLog(req.params.id, parseResult.data, userId);
    if (!log) {
      return res.status(404).json({ error: "Workout not found" });
    }

    if (exercises && Array.isArray(exercises)) {
      await storage.deleteExerciseSetsByWorkoutLog(log.id);
      if (exercises.length > 0) {
        const exerciseSetData = expandExercisesToSetRows(exercises, log.id);
        const savedSets = await storage.createExerciseSets(exerciseSetData);

        for (const ex of exercises) {
          if (ex.exerciseName === "custom" && ex.customLabel) {
            await storage.upsertCustomExercise({ userId, name: ex.customLabel, category: ex.category || "conditioning" });
          }
        }

        return res.json({ ...log, exerciseSets: savedSets });
      }
    }

    res.json(log);
  } catch (error) {
    console.error("Update workout error:", error);
    res.status(500).json({ error: "Failed to update workout" });
  }
});

router.delete("/api/workouts/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    await storage.deleteExerciseSetsByWorkoutLog(req.params.id);
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
    const userId = req.user.claims.sub;
    const history = await storage.getExerciseHistory(userId, req.params.exerciseName);
    res.json(history);
  } catch (error) {
    console.error("Exercise history error:", error);
    res.status(500).json({ error: "Failed to get exercise history" });
  }
});

router.get("/api/timeline", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
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
    const userId = req.user.claims.sub;
    const format = (req.query.format as string) || "csv";

    const timeline = await storage.getTimeline(userId);
    const plans = await storage.listTrainingPlans(userId);

    const allExerciseSets = await storage.getAllExerciseSetsWithDates(userId);

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=hyrox-training-data.json");
      const workoutLogTitles: Record<string, string> = {};
      for (const entry of timeline) {
        if (entry.workoutLogId) workoutLogTitles[entry.workoutLogId] = entry.focus || "";
      }
      const exerciseSetRows = allExerciseSets.map(s => ({
        date: s.date,
        workoutTitle: workoutLogTitles[s.workoutLogId] || "",
        exerciseName: s.exerciseName,
        customLabel: s.customLabel,
        category: s.category,
        setNumber: s.setNumber,
        reps: s.reps,
        weight: s.weight,
        distance: s.distance,
        time: s.time,
        notes: s.notes,
      }));
      return res.json({ timeline, plans, exerciseSets: exerciseSetRows, exportedAt: new Date().toISOString() });
    }

    const escapeCsv = (val: string | null | undefined) => {
      if (val == null) return "";
      const str = String(val).replace(/"/g, '""');
      return str.includes(",") || str.includes("\n") || str.includes('"') ? `"${str}"` : str;
    };

    const csvRows = ["Date,Type,Status,Focus,Main Workout,Accessory,Notes,Duration,RPE"];

    for (const entry of timeline) {
      csvRows.push([
        escapeCsv(entry.date),
        escapeCsv(entry.type),
        escapeCsv(entry.status),
        escapeCsv(entry.focus),
        escapeCsv(entry.mainWorkout),
        escapeCsv(entry.accessory),
        escapeCsv(entry.notes),
        entry.duration != null ? String(entry.duration) : "",
        entry.rpe != null ? String(entry.rpe) : "",
      ].join(","));
    }

    if (allExerciseSets.length > 0) {
      csvRows.push("");
      csvRows.push("--- EXERCISE SETS (Per-Set Data) ---");
      csvRows.push("Date,Workout,Exercise,Category,Set #,Reps,Weight,Distance (m),Time (min),Notes");
      const workoutLogTitles: Record<string, string> = {};
      for (const entry of timeline) {
        if (entry.workoutLogId) workoutLogTitles[entry.workoutLogId] = entry.focus || "";
      }
      for (const s of allExerciseSets) {
        csvRows.push([
          escapeCsv(s.date),
          escapeCsv(workoutLogTitles[s.workoutLogId] || ""),
          escapeCsv(s.customLabel || s.exerciseName),
          escapeCsv(s.category),
          String(s.setNumber),
          s.reps != null ? String(s.reps) : "",
          s.weight != null ? String(s.weight) : "",
          s.distance != null ? String(s.distance) : "",
          s.time != null ? String(s.time) : "",
          escapeCsv(s.notes),
        ].join(","));
      }
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=hyrox-training-data.csv");
    res.send(csvRows.join("\n"));
  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({ error: "Failed to export data" });
  }
});

export default router;
