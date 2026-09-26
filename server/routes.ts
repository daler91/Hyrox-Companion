import type { Server } from "node:http";

import type { Express } from "express";

import { setupAuth } from "./clerkAuth";
import { registerGarminRoutes } from "./garmin";
import { csrfProtection, csrfTokenHandler } from "./middleware/csrf";
import accountRoutes from "./routes/account";
import aiRoutes from "./routes/ai";
import analyticsRoutes from "./routes/analytics";
import authRoutes from "./routes/auth";
import coachingRoutes from "./routes/coaching";
import consentRoutes from "./routes/consent";
import emailRoutes from "./routes/email";
import { registerEmailUnsubscribeRoutes } from "./routes/emailUnsubscribe";
import nutritionRoutes from "./routes/nutrition/index";
import planProposalRoutes from "./routes/planProposals";
import planRecoveryRoutes from "./routes/planRecovery";
import planRoutes from "./routes/plans";
import preferencesRoutes from "./routes/preferences";
import pushRoutes from "./routes/push";
import recycleBinRoutes from "./routes/recycleBin";
import timelineAnnotationsRoutes from "./routes/timelineAnnotations";
import workoutRoutes from "./routes/workouts/index";
import { registerStravaRoutes } from "./strava";
import { registerStravaWebhookRoutes } from "./stravaWebhook";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);

  // CSRF token issuance must be mounted BEFORE the protecting middleware so
  // the safe-method GET can set the cookie without needing a token first.
  app.get("/api/v1/csrf-token", csrfTokenHandler);

  // Strava's webhook deliveries carry neither a session cookie nor a CSRF
  // token, so the receiver mounts ahead of the guard. It is unauthenticated
  // by design and treats every event as a hint only — see the trust model in
  // server/stravaWebhook.ts.
  registerStravaWebhookRoutes(app);

  // The email unsubscribe endpoint is the same shape: mail clients POST the
  // List-Unsubscribe URL with neither cookie nor CSRF token (RFC 8058), so it
  // mounts ahead of the guard and authorises with the signed token alone.
  // Its GET only renders a confirm page — link scanners prefetch every URL in
  // an email, so a GET that mutated would opt athletes out on their behalf.
  registerEmailUnsubscribeRoutes(app);

  // All /api/v1 mutating requests (POST/PUT/PATCH/DELETE) must carry a
  // matching x-csrf-token header. Safe methods pass through via the
  // middleware's built-in ignoredMethods list.
  app.use("/api/v1", csrfProtection);

  registerStravaRoutes(app);
  registerGarminRoutes(app);

  app.use(accountRoutes);
  app.use(authRoutes);
  app.use(preferencesRoutes);
  app.use(emailRoutes);
  app.use(aiRoutes);
  app.use(analyticsRoutes);
  app.use(workoutRoutes);
  app.use(planRoutes);
  app.use(planRecoveryRoutes);
  app.use(planProposalRoutes);
  app.use(coachingRoutes);
  app.use(consentRoutes);
  app.use(pushRoutes);
  app.use(timelineAnnotationsRoutes);
  app.use(recycleBinRoutes);
  app.use(nutritionRoutes);

  return httpServer;
}
