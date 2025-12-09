import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { chatWithCoach, type ChatMessage, type TrainingContext } from "./gemini";
import { updatePlanDaySchema, insertWorkoutLogSchema, updateWorkoutLogSchema, type InsertPlanDay } from "@shared/schema";

interface CSVRow {
  Week: string;
  Day: string;
  Focus: string;
  "Main Workout": string;
  "Accessory/Engine Work": string;
  Notes: string;
}

function parseCSV(csvText: string): CSVRow[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: CSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    rows.push(row as unknown as CSVRow);
  }

  return rows;
}

async function buildTrainingContext(): Promise<TrainingContext> {
  const timeline = await storage.getTimeline();
  const plans = await storage.listTrainingPlans();
  const workoutLogs = await storage.listWorkoutLogs();
  
  // Count by status
  let completedWorkouts = 0;
  let plannedWorkouts = 0;
  let missedWorkouts = 0;
  let skippedWorkouts = 0;
  
  const exerciseBreakdown: Record<string, number> = {};
  const recentWorkouts: TrainingContext['recentWorkouts'] = [];
  const completedDates: Set<string> = new Set();
  
  for (const entry of timeline) {
    if (entry.status === 'completed') {
      completedWorkouts++;
      if (entry.date) completedDates.add(entry.date);
    } else if (entry.status === 'planned') {
      plannedWorkouts++;
    } else if (entry.status === 'missed') {
      missedWorkouts++;
    } else if (entry.status === 'skipped') {
      skippedWorkouts++;
    }
    
    // Track exercise focus for completed workouts
    if (entry.status === 'completed' && entry.focus) {
      const focusLower = entry.focus.toLowerCase();
      // Check for Hyrox-specific exercises
      const exercises = ['running', 'skierg', 'sled push', 'sled pull', 'burpees', 'rowing', 'farmers carry', 'wall balls', 'lunges'];
      for (const exercise of exercises) {
        if (focusLower.includes(exercise)) {
          exerciseBreakdown[exercise] = (exerciseBreakdown[exercise] || 0) + 1;
        }
      }
      // Also count the focus area itself
      if (!exercises.some(e => focusLower.includes(e))) {
        exerciseBreakdown[entry.focus] = (exerciseBreakdown[entry.focus] || 0) + 1;
      }
    }
    
    // Collect recent workouts (completed or logged)
    if (entry.status === 'completed' && entry.date) {
      recentWorkouts.push({
        date: entry.date,
        focus: entry.focus || '',
        mainWorkout: entry.mainWorkout || '',
        status: entry.status,
      });
    }
  }
  
  // Sort recent workouts by date descending
  recentWorkouts.sort((a, b) => b.date.localeCompare(a.date));
  
  // Calculate current streak (consecutive days with completed workouts)
  let currentStreak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const sortedDates = Array.from(completedDates).sort().reverse();
  if (sortedDates.length > 0) {
    let checkDate = new Date(today);
    // Allow for today or yesterday to start streak
    const todayStr = checkDate.toISOString().split('T')[0];
    checkDate.setDate(checkDate.getDate() - 1);
    const yesterdayStr = checkDate.toISOString().split('T')[0];
    
    if (completedDates.has(todayStr) || completedDates.has(yesterdayStr)) {
      checkDate = completedDates.has(todayStr) ? today : new Date(today.getTime() - 86400000);
      
      while (true) {
        const dateStr = checkDate.toISOString().split('T')[0];
        if (completedDates.has(dateStr)) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    }
  }
  
  const totalWorkouts = completedWorkouts + plannedWorkouts + missedWorkouts + skippedWorkouts;
  const completionRate = (completedWorkouts + missedWorkouts + skippedWorkouts) > 0
    ? Math.round((completedWorkouts / (completedWorkouts + missedWorkouts + skippedWorkouts)) * 100)
    : 0;
  
  // Get active plan info
  let activePlan: TrainingContext['activePlan'];
  if (plans.length > 0) {
    const plan = plans[0]; // Use most recent plan
    activePlan = {
      name: plan.name,
      totalWeeks: plan.totalWeeks,
    };
  }
  
  return {
    totalWorkouts,
    completedWorkouts,
    plannedWorkouts,
    missedWorkouts,
    skippedWorkouts,
    completionRate,
    currentStreak,
    recentWorkouts: recentWorkouts.slice(0, 10),
    exerciseBreakdown,
    activePlan,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Chat endpoint for AI coach with training data context
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history } = req.body as {
        message: string;
        history?: ChatMessage[];
      };

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      // Fetch training data to provide context to the AI
      const trainingContext = await buildTrainingContext();
      
      const response = await chatWithCoach(message, history || [], trainingContext);
      res.json({ response });
    } catch (error) {
      console.error("Chat error:", error);
      res.status(500).json({ error: "Failed to get response from AI coach" });
    }
  });

  // List all training plans
  app.get("/api/plans", async (_req, res) => {
    try {
      const plans = await storage.listTrainingPlans();
      res.json(plans);
    } catch (error) {
      console.error("List plans error:", error);
      res.status(500).json({ error: "Failed to list training plans" });
    }
  });

  // Get a specific training plan with all days
  app.get("/api/plans/:id", async (req, res) => {
    try {
      const plan = await storage.getTrainingPlan(req.params.id);
      if (!plan) {
        return res.status(404).json({ error: "Training plan not found" });
      }
      res.json(plan);
    } catch (error) {
      console.error("Get plan error:", error);
      res.status(500).json({ error: "Failed to get training plan" });
    }
  });

  // Import a training plan from CSV
  app.post("/api/plans/import", async (req, res) => {
    try {
      const { csvContent, fileName, planName } = req.body as {
        csvContent: string;
        fileName?: string;
        planName?: string;
      };

      if (!csvContent) {
        return res.status(400).json({ error: "CSV content is required" });
      }

      const rows = parseCSV(csvContent);
      if (rows.length === 0) {
        return res.status(400).json({ error: "No valid rows found in CSV" });
      }

      const weekNumbers = rows.map((r) => parseInt(r.Week)).filter((n) => !isNaN(n) && n > 0);
      if (weekNumbers.length === 0) {
        return res.status(400).json({ error: "No valid week numbers found in CSV" });
      }
      const totalWeeks = Math.max(...weekNumbers);

      const plan = await storage.createTrainingPlan({
        name: planName || fileName?.replace(".csv", "") || "Imported Plan",
        sourceFileName: fileName || null,
        totalWeeks,
      });

      const days: InsertPlanDay[] = rows
        .filter((row) => row.Week && row.Day)
        .map((row) => ({
          planId: plan.id,
          weekNumber: parseInt(row.Week) || 1,
          dayName: row.Day,
          focus: row.Focus || "",
          mainWorkout: row["Main Workout"] || "",
          accessory: row["Accessory/Engine Work"] || null,
          notes: row.Notes || null,
        }));

      await storage.createPlanDays(days);

      const fullPlan = await storage.getTrainingPlan(plan.id);
      res.json(fullPlan);
    } catch (error) {
      console.error("Import plan error:", error);
      res.status(500).json({ error: "Failed to import training plan" });
    }
  });

  // Update a specific day in a plan
  app.patch("/api/plans/:planId/days/:dayId", async (req, res) => {
    try {
      const { dayId } = req.params;

      const parseResult = updatePlanDaySchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid update data", details: parseResult.error });
      }

      const updatedDay = await storage.updatePlanDay(dayId, parseResult.data);
      if (!updatedDay) {
        return res.status(404).json({ error: "Day not found" });
      }

      res.json(updatedDay);
    } catch (error) {
      console.error("Update day error:", error);
      res.status(500).json({ error: "Failed to update day" });
    }
  });

  // Delete a training plan
  app.delete("/api/plans/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteTrainingPlan(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Training plan not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete plan error:", error);
      res.status(500).json({ error: "Failed to delete training plan" });
    }
  });

  // Workout Logs endpoints
  app.get("/api/workouts", async (_req, res) => {
    try {
      const logs = await storage.listWorkoutLogs();
      res.json(logs);
    } catch (error) {
      console.error("List workouts error:", error);
      res.status(500).json({ error: "Failed to list workouts" });
    }
  });

  app.get("/api/workouts/:id", async (req, res) => {
    try {
      const log = await storage.getWorkoutLog(req.params.id);
      if (!log) {
        return res.status(404).json({ error: "Workout not found" });
      }
      res.json(log);
    } catch (error) {
      console.error("Get workout error:", error);
      res.status(500).json({ error: "Failed to get workout" });
    }
  });

  app.post("/api/workouts", async (req, res) => {
    try {
      const parseResult = insertWorkoutLogSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid workout data", details: parseResult.error });
      }

      const log = await storage.createWorkoutLog(parseResult.data);
      res.json(log);
    } catch (error) {
      console.error("Create workout error:", error);
      res.status(500).json({ error: "Failed to create workout" });
    }
  });

  app.patch("/api/workouts/:id", async (req, res) => {
    try {
      const parseResult = updateWorkoutLogSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid update data", details: parseResult.error });
      }

      const log = await storage.updateWorkoutLog(req.params.id, parseResult.data);
      if (!log) {
        return res.status(404).json({ error: "Workout not found" });
      }
      res.json(log);
    } catch (error) {
      console.error("Update workout error:", error);
      res.status(500).json({ error: "Failed to update workout" });
    }
  });

  app.delete("/api/workouts/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteWorkoutLog(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Workout not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete workout error:", error);
      res.status(500).json({ error: "Failed to delete workout" });
    }
  });

  // Timeline endpoint - unified view of plans and workouts
  app.get("/api/timeline", async (req, res) => {
    try {
      const planId = req.query.planId as string | undefined;
      const entries = await storage.getTimeline(planId);
      res.json(entries);
    } catch (error) {
      console.error("Timeline error:", error);
      res.status(500).json({ error: "Failed to get timeline" });
    }
  });

  // Update plan day status (for marking as skipped, completed, etc.)
  app.patch("/api/plans/days/:dayId/status", async (req, res) => {
    try {
      const { dayId } = req.params;
      const { status, scheduledDate } = req.body as { status?: string; scheduledDate?: string };

      const updates: Record<string, string | null> = {};
      if (status) updates.status = status;
      if (scheduledDate !== undefined) updates.scheduledDate = scheduledDate;

      const updatedDay = await storage.updatePlanDay(dayId, updates);
      if (!updatedDay) {
        return res.status(404).json({ error: "Day not found" });
      }

      res.json(updatedDay);
    } catch (error) {
      console.error("Update day status error:", error);
      res.status(500).json({ error: "Failed to update day status" });
    }
  });

  return httpServer;
}
