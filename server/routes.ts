import type { Express } from "express";
import type { Server } from "http";
import { setupAuth } from "./replitAuth";
import { registerStravaRoutes } from "./strava";

import aiRoutes from "./routes/ai";
import analyticsRoutes from "./routes/analytics";
import workoutRoutes from "./routes/workouts";
import planRoutes from "./routes/plans";
import authRoutes from "./routes/auth";
import preferencesRoutes from "./routes/preferences";
import emailRoutes from "./routes/email";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerStravaRoutes(app);

  app.use(authRoutes);
  app.use(preferencesRoutes);
  app.use(emailRoutes);
  app.use(aiRoutes);
  app.use(analyticsRoutes);
  app.use(workoutRoutes);
  app.use(planRoutes);

  return httpServer;
}
