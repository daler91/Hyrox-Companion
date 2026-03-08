import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { storage } from "./storage";
import { updateUserPreferencesSchema } from "@shared/schema";
import { registerStravaRoutes } from "./strava";
import { checkAndSendEmailsForUser, runEmailCronJob } from "./emailScheduler";

import aiRoutes from "./routes/ai";
import analyticsRoutes from "./routes/analytics";
import workoutRoutes from "./routes/workouts";
import planRoutes from "./routes/plans";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerStravaRoutes(app);

  app.use(aiRoutes);
  app.use(analyticsRoutes);
  app.use(workoutRoutes);
  app.use(planRoutes);

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
        emailNotifications: user.emailNotifications ?? 1,
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
        emailNotifications: user.emailNotifications ?? 1,
      });
    } catch (error) {
      console.error("Error updating preferences:", error);
      res.status(500).json({ error: "Failed to update preferences" });
    }
  });

  app.post("/api/emails/check", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.json({ sent: [] });
      }
      const sent = await checkAndSendEmailsForUser(storage, user);
      res.json({ sent });
    } catch (error) {
      console.error("Error checking emails:", error);
      res.json({ sent: [], error: "Email check failed" });
    }
  });

  app.get("/api/cron/emails", async (req, res) => {
    const secret = (req.headers["x-cron-secret"] as string) || (req.query.secret as string);
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || secret !== cronSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const result = await runEmailCronJob(storage);
      res.json(result);
    } catch (error) {
      console.error("Cron email error:", error);
      res.status(500).json({ error: "Cron job failed" });
    }
  });

  return httpServer;
}
