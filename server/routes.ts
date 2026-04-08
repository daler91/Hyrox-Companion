import type { Server } from "node:http";

import type { Express } from "express";

import { setupAuth } from "./clerkAuth";
import { csrfProtection, csrfTokenHandler } from "./middleware/csrf";
import aiRoutes from "./routes/ai";
import analyticsRoutes from "./routes/analytics";
import authRoutes from "./routes/auth";
import coachingRoutes from "./routes/coaching";
import emailRoutes from "./routes/email";
import planRoutes from "./routes/plans";
import preferencesRoutes from "./routes/preferences";
import pushRoutes from "./routes/push";
import workoutRoutes from "./routes/workouts";
import { registerStravaRoutes } from "./strava";

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
  app.use(pushRoutes);

  return httpServer;
}
