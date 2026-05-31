import type { Server } from "node:http";

import type { Express } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setupAuth } from "./clerkAuth";
import { registerGarminRoutes } from "./garmin";
import { csrfProtection, csrfTokenHandler } from "./middleware/csrf";
import { registerRoutes } from "./routes";
import accountRoutes from "./routes/account";
import aiRoutes from "./routes/ai";
import analyticsRoutes from "./routes/analytics";
import authRoutes from "./routes/auth";
import coachingRoutes from "./routes/coaching";
import emailRoutes from "./routes/email";
import planRoutes from "./routes/plans";
import preferencesRoutes from "./routes/preferences";
import pushRoutes from "./routes/push";
import timelineAnnotationsRoutes from "./routes/timelineAnnotations";
import workoutRoutes from "./routes/workouts/index";
import { registerStravaRoutes } from "./strava";

// Mock dependencies
vi.mock("./clerkAuth", () => ({ setupAuth: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./garmin", () => ({ registerGarminRoutes: vi.fn() }));
vi.mock("./strava", () => ({ registerStravaRoutes: vi.fn() }));
vi.mock("./middleware/csrf", () => ({
  csrfProtection: vi.fn(),
  csrfTokenHandler: vi.fn()
}));

// Mock routers
vi.mock("./routes/account", () => ({ default: { name: "accountRoutes" } }));
vi.mock("./routes/ai", () => ({ default: { name: "aiRoutes" } }));
vi.mock("./routes/analytics", () => ({ default: { name: "analyticsRoutes" } }));
vi.mock("./routes/auth", () => ({ default: { name: "authRoutes" } }));
vi.mock("./routes/coaching", () => ({ default: { name: "coachingRoutes" } }));
vi.mock("./routes/email", () => ({ default: { name: "emailRoutes" } }));
vi.mock("./routes/plans", () => ({ default: { name: "planRoutes" } }));
vi.mock("./routes/preferences", () => ({ default: { name: "preferencesRoutes" } }));
vi.mock("./routes/push", () => ({ default: { name: "pushRoutes" } }));
vi.mock("./routes/timelineAnnotations", () => ({ default: { name: "timelineAnnotationsRoutes" } }));
vi.mock("./routes/workouts/index", () => ({ default: { name: "workoutRoutes" } }));

describe("registerRoutes", () => {
  let app: Partial<Express>;
  let httpServer: Server;

  beforeEach(() => {
    vi.clearAllMocks();
    app = {
      get: vi.fn(),
      use: vi.fn()
    };
    httpServer = {} as Server;
  });

  it("should setup authentication", async () => {
    await registerRoutes(httpServer, app);
    expect(setupAuth).toHaveBeenCalledWith(app);
  });

  it("should mount CSRF protection correctly", async () => {
    await registerRoutes(httpServer, app);

    // CSRF token handler should be mounted BEFORE csrfProtection
    expect(app.get).toHaveBeenCalledWith("/api/v1/csrf-token", csrfTokenHandler);

    // csrfProtection should be mounted on /api/v1
    expect(app.use).toHaveBeenCalledWith("/api/v1", csrfProtection);
  });

  it("should register third-party integration routes", async () => {
    await registerRoutes(httpServer, app);

    expect(registerStravaRoutes).toHaveBeenCalledWith(app);
    expect(registerGarminRoutes).toHaveBeenCalledWith(app);
  });

  it("should mount all application routers", async () => {
    await registerRoutes(httpServer, app);

    expect(app.use).toHaveBeenCalledWith(accountRoutes);
    expect(app.use).toHaveBeenCalledWith(authRoutes);
    expect(app.use).toHaveBeenCalledWith(preferencesRoutes);
    expect(app.use).toHaveBeenCalledWith(emailRoutes);
    expect(app.use).toHaveBeenCalledWith(aiRoutes);
    expect(app.use).toHaveBeenCalledWith(analyticsRoutes);
    expect(app.use).toHaveBeenCalledWith(workoutRoutes);
    expect(app.use).toHaveBeenCalledWith(planRoutes);
    expect(app.use).toHaveBeenCalledWith(coachingRoutes);
    expect(app.use).toHaveBeenCalledWith(pushRoutes);
    expect(app.use).toHaveBeenCalledWith(timelineAnnotationsRoutes);
  });

  it("should return the provided HTTP server instance", async () => {
    const result = await registerRoutes(httpServer, app);
    expect(result).toBe(httpServer);
  });
});
