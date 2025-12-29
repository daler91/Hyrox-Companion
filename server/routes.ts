import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { chatWithCoach, streamChatWithCoach, generateWorkoutSuggestions, type ChatMessage, type TrainingContext, type UpcomingWorkout } from "./gemini";
import { updatePlanDaySchema, insertWorkoutLogSchema, updateWorkoutLogSchema, updateUserPreferencesSchema, type InsertPlanDay } from "@shared/schema";
import { registerStravaRoutes } from "./strava";

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
  registerStravaRoutes(app);

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

  // Streaming chat endpoint using Server-Sent Events
  app.post("/api/chat/stream", isAuthenticated, async (req: any, res) => {
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

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      try {
        const stream = streamChatWithCoach(message, history || [], trainingContext);
        
        for await (const chunk of stream) {
          // Send each chunk as an SSE data event
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
        
        // Send completion event
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      } catch (streamError) {
        console.error("Stream error:", streamError);
        res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
        res.end();
      }
    } catch (error) {
      console.error("Chat stream error:", error);
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

  // Create sample 8-week Hyrox training plan
  app.post("/api/plans/sample", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      const samplePlanDays = [
        // Week 1 - Foundation
        { week: 1, day: "Monday", focus: "Running Base", main: "5km easy run at conversational pace", accessory: "Core circuit: 3x(20 plank, 15 dead bugs, 20 bird dogs)", notes: "Focus on form and breathing" },
        { week: 1, day: "Tuesday", focus: "Strength", main: "4x8 goblet squats, 4x8 Romanian deadlifts, 4x8 push-ups", accessory: "3x20 walking lunges", notes: "Keep weights moderate" },
        { week: 1, day: "Wednesday", focus: "SkiErg", main: "5x500m SkiErg with 90s rest", accessory: "3x10 lat pulldowns, 3x12 face pulls", notes: "Focus on full arm extension" },
        { week: 1, day: "Thursday", focus: "Active Recovery", main: "30min easy bike or swim", accessory: "Foam rolling and stretching", notes: null },
        { week: 1, day: "Friday", focus: "Sled Work", main: "6x50m sled push (moderate weight), 6x50m sled pull", accessory: "3x10 KB swings", notes: "Short rest between sets" },
        { week: 1, day: "Saturday", focus: "Long Run", main: "8km steady run", accessory: null, notes: "Build aerobic base" },
        { week: 1, day: "Sunday", focus: "Rest", main: "Complete rest or light walk", accessory: null, notes: null },
        
        // Week 2 - Building
        { week: 2, day: "Monday", focus: "Running Intervals", main: "6x400m at 5K pace with 200m jog recovery", accessory: "Core: 3x(30s plank, 20 Russian twists)", notes: null },
        { week: 2, day: "Tuesday", focus: "Upper Strength", main: "5x5 bench press, 5x5 barbell rows, 3x8 overhead press", accessory: "3x15 tricep dips, 3x12 bicep curls", notes: null },
        { week: 2, day: "Wednesday", focus: "Rowing", main: "4x1000m row with 2min rest", accessory: "3x12 seated cable rows", notes: "Target 2:00/500m pace" },
        { week: 2, day: "Thursday", focus: "Active Recovery", main: "30min yoga or mobility work", accessory: null, notes: null },
        { week: 2, day: "Friday", focus: "Functional", main: "50 burpee broad jumps for time, 100 wall balls", accessory: "3x10 box jumps", notes: "Break as needed" },
        { week: 2, day: "Saturday", focus: "Long Run + Carry", main: "10km run with 4x200m farmers carry breaks", accessory: null, notes: "Practice transitions" },
        { week: 2, day: "Sunday", focus: "Rest", main: "Complete rest", accessory: null, notes: null },
        
        // Week 3 - Intensity
        { week: 3, day: "Monday", focus: "Tempo Run", main: "3km warmup, 4km tempo at threshold, 2km cooldown", accessory: "Core: 4x(25 bicycle crunches, 15 leg raises)", notes: null },
        { week: 3, day: "Tuesday", focus: "Lower Strength", main: "5x5 back squats, 4x6 front squats, 4x8 step-ups", accessory: "3x15 calf raises, 3x12 leg curls", notes: null },
        { week: 3, day: "Wednesday", focus: "SkiErg + Sled", main: "3x(1000m ski, 100m sled push, 100m sled pull)", accessory: null, notes: "Minimal rest between movements" },
        { week: 3, day: "Thursday", focus: "Active Recovery", main: "40min easy swim or bike", accessory: "Hip mobility work", notes: null },
        { week: 3, day: "Friday", focus: "Burpees + Row", main: "5x(20 burpees, 500m row)", accessory: "3x20 KB swings", notes: "Target under 5min per round" },
        { week: 3, day: "Saturday", focus: "Long Run", main: "12km progressive run (last 4km at tempo)", accessory: null, notes: null },
        { week: 3, day: "Sunday", focus: "Rest", main: "Complete rest", accessory: null, notes: null },
        
        // Week 4 - Recovery Week
        { week: 4, day: "Monday", focus: "Easy Run", main: "5km easy run", accessory: "Light core work", notes: "Deload week" },
        { week: 4, day: "Tuesday", focus: "Light Strength", main: "3x10 bodyweight squats, 3x10 push-ups, 3x10 inverted rows", accessory: "Mobility work", notes: "50% intensity" },
        { week: 4, day: "Wednesday", focus: "Easy Cardio", main: "30min easy bike or elliptical", accessory: "Stretching", notes: null },
        { week: 4, day: "Thursday", focus: "Rest", main: "Complete rest", accessory: null, notes: null },
        { week: 4, day: "Friday", focus: "Light Movement", main: "3km jog, light sled work", accessory: null, notes: null },
        { week: 4, day: "Saturday", focus: "Easy Run", main: "6km easy run", accessory: null, notes: null },
        { week: 4, day: "Sunday", focus: "Rest", main: "Complete rest", accessory: null, notes: null },
        
        // Week 5 - Race Simulation
        { week: 5, day: "Monday", focus: "Speed Work", main: "8x200m sprints with 90s rest", accessory: "Core: 4x(30s hollow hold, 20 mountain climbers)", notes: null },
        { week: 5, day: "Tuesday", focus: "Heavy Strength", main: "5x3 deadlifts, 4x5 weighted lunges, 4x8 hip thrusts", accessory: "3x12 leg press", notes: null },
        { week: 5, day: "Wednesday", focus: "Hyrox Simulation", main: "4 rounds: 1km run, 500m ski, 500m row", accessory: null, notes: "Race pace practice" },
        { week: 5, day: "Thursday", focus: "Active Recovery", main: "45min yoga", accessory: null, notes: null },
        { week: 5, day: "Friday", focus: "Wall Balls + Carry", main: "100 wall balls, 400m farmers carry, 100 wall balls", accessory: null, notes: "Break as needed" },
        { week: 5, day: "Saturday", focus: "Long Run", main: "14km at marathon pace", accessory: null, notes: null },
        { week: 5, day: "Sunday", focus: "Rest", main: "Complete rest", accessory: null, notes: null },
        
        // Week 6 - Peak Training
        { week: 6, day: "Monday", focus: "Interval Run", main: "5x800m at 5K pace with 400m jog recovery", accessory: "Core circuit", notes: null },
        { week: 6, day: "Tuesday", focus: "Full Body", main: "5x5 power cleans, 4x8 push press, 4x10 pull-ups", accessory: "3x15 dips", notes: null },
        { week: 6, day: "Wednesday", focus: "Mini Hyrox", main: "8 rounds: 1km run + 1 station (rotate through all 8)", accessory: null, notes: "Full race simulation" },
        { week: 6, day: "Thursday", focus: "Active Recovery", main: "30min easy swim", accessory: "Foam rolling", notes: null },
        { week: 6, day: "Friday", focus: "Sled + Burpees", main: "5x(100m sled push, 100m sled pull, 20 burpees)", accessory: null, notes: null },
        { week: 6, day: "Saturday", focus: "Race Pace Run", main: "10km at target race pace", accessory: null, notes: null },
        { week: 6, day: "Sunday", focus: "Rest", main: "Complete rest", accessory: null, notes: null },
        
        // Week 7 - Taper Start
        { week: 7, day: "Monday", focus: "Tempo Run", main: "2km warmup, 5km tempo, 2km cooldown", accessory: "Light core", notes: "Taper begins" },
        { week: 7, day: "Tuesday", focus: "Maintenance Strength", main: "3x5 squats, 3x5 deadlifts at 70%", accessory: null, notes: "Reduce volume" },
        { week: 7, day: "Wednesday", focus: "Light Simulation", main: "4 rounds: 800m run + 250m ski + 250m row", accessory: null, notes: "60% effort" },
        { week: 7, day: "Thursday", focus: "Rest", main: "Complete rest", accessory: null, notes: null },
        { week: 7, day: "Friday", focus: "Easy Movement", main: "Light sled work, 50 wall balls", accessory: null, notes: "Stay loose" },
        { week: 7, day: "Saturday", focus: "Easy Run", main: "8km easy run with strides", accessory: null, notes: null },
        { week: 7, day: "Sunday", focus: "Rest", main: "Complete rest", accessory: null, notes: null },
        
        // Week 8 - Race Week
        { week: 8, day: "Monday", focus: "Shakeout Run", main: "4km easy with 4x100m strides", accessory: null, notes: "Stay fresh" },
        { week: 8, day: "Tuesday", focus: "Light Movement", main: "20min easy bike, light stretching", accessory: null, notes: null },
        { week: 8, day: "Wednesday", focus: "Activation", main: "2km jog, 10 burpees, 250m row, 250m ski", accessory: null, notes: "Keep it light" },
        { week: 8, day: "Thursday", focus: "Rest", main: "Complete rest, hydrate well", accessory: null, notes: "Pre-race prep" },
        { week: 8, day: "Friday", focus: "Rest", main: "Complete rest, carb loading", accessory: null, notes: null },
        { week: 8, day: "Saturday", focus: "RACE DAY", main: "HYROX RACE - Give it everything!", accessory: null, notes: "Trust your training!" },
        { week: 8, day: "Sunday", focus: "Recovery", main: "Light walk, celebrate!", accessory: null, notes: "Well done!" },
      ];

      const plan = await storage.createTrainingPlan({
        userId,
        name: "8-Week Hyrox Training Plan",
        sourceFileName: null,
        totalWeeks: 8,
      });

      const days: InsertPlanDay[] = samplePlanDays.map((d) => ({
        planId: plan.id,
        weekNumber: d.week,
        dayName: d.day,
        focus: d.focus,
        mainWorkout: d.main,
        accessory: d.accessory,
        notes: d.notes,
      }));

      await storage.createPlanDays(days);

      const fullPlan = await storage.getTrainingPlan(plan.id, userId);
      res.json(fullPlan);
    } catch (error) {
      console.error("Create sample plan error:", error);
      res.status(500).json({ error: "Failed to create sample plan" });
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

  // Simplified route for updating plan day by dayId only (used by AI suggestions)
  app.patch("/api/plans/days/:dayId", isAuthenticated, async (req: any, res) => {
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

      // If changing to a non-completed status, delete any linked workout log
      if (status && status !== "completed") {
        await storage.deleteWorkoutLogByPlanDayId(dayId, userId);
      }

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

  app.delete("/api/plans/days/:dayId", isAuthenticated, async (req: any, res) => {
    try {
      const { dayId } = req.params;
      const userId = req.user.claims.sub;
      const deleted = await storage.deletePlanDay(dayId, userId);
      if (!deleted) {
        return res.status(404).json({ error: "Plan day not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete plan day error:", error);
      res.status(500).json({ error: "Failed to delete plan day" });
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

      const rawSuggestions = await generateWorkoutSuggestions(trainingContext, upcomingWorkouts);
      
      // Map suggestions to include date and focus from original workout data
      const workoutMap = new Map(upcomingWorkouts.map(w => [w.id, w]));
      const suggestions = rawSuggestions
        .map(s => {
          const workout = workoutMap.get(s.workoutId);
          return {
            workoutId: s.workoutId,
            date: workout?.date || s.workoutDate || '',
            focus: workout?.focus || s.workoutFocus || '',
            targetField: s.targetField || 'notes',
            action: s.action || 'append',
            recommendation: s.recommendation,
            rationale: s.rationale,
            priority: s.priority,
          };
        })
        .filter(s => s.date && s.focus && s.recommendation);
      
      res.json({ suggestions });
    } catch (error) {
      console.error("AI suggestions error:", error);
      res.status(500).json({ error: "Failed to generate AI suggestions" });
    }
  });

  return httpServer;
}
