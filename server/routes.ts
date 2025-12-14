import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { chatWithCoach, generateWorkoutSuggestions, type ChatMessage, type TrainingContext, type UpcomingWorkout } from "./gemini";
import { updatePlanDaySchema, insertWorkoutLogSchema, updateWorkoutLogSchema, updateUserPreferencesSchema, type InsertPlanDay } from "@shared/schema";

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

async function buildTrainingContext(userId: string): Promise<TrainingContext> {
  const timeline = await storage.getTimeline(userId);
  const plans = await storage.listTrainingPlans(userId);
  const workoutLogs = await storage.listWorkoutLogs(userId);
  
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
    
    if (entry.status === 'completed' && entry.focus) {
      const focusLower = entry.focus.toLowerCase();
      const exercises = ['running', 'skierg', 'sled push', 'sled pull', 'burpees', 'rowing', 'farmers carry', 'wall balls', 'lunges'];
      for (const exercise of exercises) {
        if (focusLower.includes(exercise)) {
          exerciseBreakdown[exercise] = (exerciseBreakdown[exercise] || 0) + 1;
        }
      }
      if (!exercises.some(e => focusLower.includes(e))) {
        exerciseBreakdown[entry.focus] = (exerciseBreakdown[entry.focus] || 0) + 1;
      }
    }
    
    if (entry.status === 'completed' && entry.date) {
      recentWorkouts.push({
        date: entry.date,
        focus: entry.focus || '',
        mainWorkout: entry.mainWorkout || '',
        status: entry.status,
      });
    }
  }
  
  recentWorkouts.sort((a, b) => b.date.localeCompare(a.date));
  
  let currentStreak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const sortedDates = Array.from(completedDates).sort().reverse();
  if (sortedDates.length > 0) {
    let checkDate = new Date(today);
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
  
  let activePlan: TrainingContext['activePlan'];
  if (plans.length > 0) {
    const plan = plans[0];
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
  await setupAuth(app);

  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  app.get('/api/preferences', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({
        weightUnit: user.weightUnit || "kg",
        distanceUnit: user.distanceUnit || "km",
        weeklyGoal: user.weeklyGoal || 5,
      });
    } catch (error) {
      console.error("Error fetching preferences:", error);
      res.status(500).json({ error: "Failed to fetch preferences" });
    }
  });

  app.patch('/api/preferences', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const parseResult = updateUserPreferencesSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid preferences data", details: parseResult.error });
      }
      
      const user = await storage.updateUserPreferences(userId, parseResult.data);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({
        weightUnit: user.weightUnit,
        distanceUnit: user.distanceUnit,
        weeklyGoal: user.weeklyGoal,
      });
    } catch (error) {
      console.error("Error updating preferences:", error);
      res.status(500).json({ error: "Failed to update preferences" });
    }
  });

  app.post("/api/chat", isAuthenticated, async (req: any, res) => {
    try {
      const { message, history } = req.body as {
        message: string;
        history?: ChatMessage[];
      };

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      const userId = req.user.claims.sub;
      const trainingContext = await buildTrainingContext(userId);
      
      const response = await chatWithCoach(message, history || [], trainingContext);
      res.json({ response });
    } catch (error) {
      console.error("Chat error:", error);
      res.status(500).json({ error: "Failed to get response from AI coach" });
    }
  });

  app.get("/api/chat/history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const messages = await storage.getChatMessages(userId);
      res.json(messages);
    } catch (error) {
      console.error("Get chat history error:", error);
      res.status(500).json({ error: "Failed to get chat history" });
    }
  });

  app.post("/api/chat/message", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { role, content } = req.body as { role: string; content: string };

      if (!role || !content) {
        return res.status(400).json({ error: "Role and content are required" });
      }

      const message = await storage.saveChatMessage({ userId, role, content });
      res.json(message);
    } catch (error) {
      console.error("Save chat message error:", error);
      res.status(500).json({ error: "Failed to save message" });
    }
  });

  app.delete("/api/chat/history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      await storage.clearChatHistory(userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Clear chat history error:", error);
      res.status(500).json({ error: "Failed to clear chat history" });
    }
  });

  app.get("/api/plans", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const plans = await storage.listTrainingPlans(userId);
      res.json(plans);
    } catch (error) {
      console.error("List plans error:", error);
      res.status(500).json({ error: "Failed to list training plans" });
    }
  });

  app.get("/api/plans/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const plan = await storage.getTrainingPlan(req.params.id, userId);
      if (!plan) {
        return res.status(404).json({ error: "Training plan not found" });
      }
      res.json(plan);
    } catch (error) {
      console.error("Get plan error:", error);
      res.status(500).json({ error: "Failed to get training plan" });
    }
  });

  app.post("/api/plans/import", isAuthenticated, async (req: any, res) => {
    try {
      const { csvContent, fileName, planName } = req.body as {
        csvContent: string;
        fileName?: string;
        planName?: string;
      };

      if (!csvContent) {
        return res.status(400).json({ error: "CSV content is required" });
      }

      const userId = req.user.claims.sub;
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
        userId,
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

      const fullPlan = await storage.getTrainingPlan(plan.id, userId);
      res.json(fullPlan);
    } catch (error) {
      console.error("Import plan error:", error);
      res.status(500).json({ error: "Failed to import training plan" });
    }
  });

  app.patch("/api/plans/:planId/days/:dayId", isAuthenticated, async (req: any, res) => {
    try {
      const { dayId } = req.params;
      const userId = req.user.claims.sub;

      const parseResult = updatePlanDaySchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid update data", details: parseResult.error });
      }

      const updatedDay = await storage.updatePlanDay(dayId, parseResult.data, userId);
      if (!updatedDay) {
        return res.status(404).json({ error: "Day not found" });
      }

      res.json(updatedDay);
    } catch (error) {
      console.error("Update day error:", error);
      res.status(500).json({ error: "Failed to update day" });
    }
  });

  app.delete("/api/plans/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const deleted = await storage.deleteTrainingPlan(req.params.id, userId);
      if (!deleted) {
        return res.status(404).json({ error: "Training plan not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete plan error:", error);
      res.status(500).json({ error: "Failed to delete training plan" });
    }
  });

  app.get("/api/workouts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const logs = await storage.listWorkoutLogs(userId);
      res.json(logs);
    } catch (error) {
      console.error("List workouts error:", error);
      res.status(500).json({ error: "Failed to list workouts" });
    }
  });

  app.get("/api/workouts/:id", isAuthenticated, async (req: any, res) => {
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

  app.post("/api/workouts", isAuthenticated, async (req: any, res) => {
    try {
      const parseResult = insertWorkoutLogSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid workout data", details: parseResult.error });
      }

      const userId = req.user.claims.sub;
      const log = await storage.createWorkoutLog({ ...parseResult.data, userId });
      res.json(log);
    } catch (error) {
      console.error("Create workout error:", error);
      res.status(500).json({ error: "Failed to create workout" });
    }
  });

  app.patch("/api/workouts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const parseResult = updateWorkoutLogSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid update data", details: parseResult.error });
      }

      const userId = req.user.claims.sub;
      const log = await storage.updateWorkoutLog(req.params.id, parseResult.data, userId);
      if (!log) {
        return res.status(404).json({ error: "Workout not found" });
      }
      res.json(log);
    } catch (error) {
      console.error("Update workout error:", error);
      res.status(500).json({ error: "Failed to update workout" });
    }
  });

  app.delete("/api/workouts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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

  app.get("/api/timeline", isAuthenticated, async (req: any, res) => {
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

  app.patch("/api/plans/days/:dayId/status", isAuthenticated, async (req: any, res) => {
    try {
      const { dayId } = req.params;
      const userId = req.user.claims.sub;
      const { status, scheduledDate } = req.body as { status?: string; scheduledDate?: string };

      const updates: Record<string, string | null> = {};
      if (status) updates.status = status;
      if (scheduledDate !== undefined) updates.scheduledDate = scheduledDate;

      const updatedDay = await storage.updatePlanDay(dayId, updates, userId);
      if (!updatedDay) {
        return res.status(404).json({ error: "Day not found" });
      }

      res.json(updatedDay);
    } catch (error) {
      console.error("Update day status error:", error);
      res.status(500).json({ error: "Failed to update day status" });
    }
  });

  app.post("/api/timeline/ai-suggestions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      // Get training context (past workout data)
      const trainingContext = await buildTrainingContext(userId);
      
      // Get timeline and filter for upcoming planned workouts
      const timeline = await storage.getTimeline(userId);
      const today = new Date().toISOString().split('T')[0];
      
      const upcomingWorkouts: UpcomingWorkout[] = timeline
        .filter(entry => 
          entry.status === 'planned' && 
          entry.date && 
          entry.date >= today &&
          entry.planDayId !== null
        )
        .sort((a, b) => a.date!.localeCompare(b.date!))
        .slice(0, 5)
        .map(entry => ({
          id: entry.planDayId!,
          date: entry.date!,
          focus: entry.focus || '',
          mainWorkout: entry.mainWorkout || '',
          accessory: entry.accessory || undefined,
        }));

      if (upcomingWorkouts.length === 0) {
        return res.json({ suggestions: [], message: "No upcoming planned workouts found" });
      }

      const suggestions = await generateWorkoutSuggestions(trainingContext, upcomingWorkouts);
      res.json({ suggestions });
    } catch (error) {
      console.error("AI suggestions error:", error);
      res.status(500).json({ error: "Failed to generate AI suggestions" });
    }
  });

  return httpServer;
}
