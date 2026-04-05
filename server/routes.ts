import type { Express } from "express";
import type { Server } from "node:http";
import { setupAuth } from "./clerkAuth";
import { registerStravaRoutes } from "./strava";
import { csrfProtection, csrfTokenHandler } from "./middleware/csrf";

import aiRoutes from "./routes/ai";
import analyticsRoutes from "./routes/analytics";
import workoutRoutes from "./routes/workouts";
import planRoutes from "./routes/plans";
import authRoutes from "./routes/auth";
import preferencesRoutes from "./routes/preferences";
import emailRoutes from "./routes/email";
import coachingRoutes from "./routes/coaching";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);

  // CSRF token issuance must be mounted BEFORE the protecting middleware so
  // the safe-method GET can set the cookie without needing a token first.
  app.get("/api/v1/csrf-token", csrfTokenHandler);

  // All /api/v1 mutating requests (POST/PUT/PATCH/DELETE) must carry a
  // matching x-csrf-token header. Safe methods pass through via the
  // middleware's built-in ignoredMethods list.
  app.use("/api/v1", csrfProtection);

  registerStravaRoutes(app);

  app.use(authRoutes);
  app.use(preferencesRoutes);
  app.use(emailRoutes);
  app.use(aiRoutes);
  app.use(analyticsRoutes);
  app.use(workoutRoutes);
  app.use(planRoutes);
  app.use(coachingRoutes);

  return httpServer;
}
