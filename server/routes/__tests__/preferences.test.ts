import express from "express";
import request from "supertest";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { storage } from "../../storage";
import preferencesRouter from "../preferences";
import { createTestApp } from "./testUtils";

// Mock the clerkAuth middleware to simulate authentication
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { userId: "test_user_id" };
    next();
  },
}));

// Mock the getUserId function to return our test user
vi.mock("../../types", () => ({
  getUserId: () => "test_user_id",
}));

// Mock the storage functions
vi.mock("../../storage", () => ({
  storage: {
    users: {
      getUser: vi.fn(),
      updateUserPreferences: vi.fn(),
    },
    plans: {
      getActivePlan: vi.fn(),
      getPlanWeeklyDensity: vi.fn(),
    },
  },
}));

describe("GET /api/preferences", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp(preferencesRouter);

  });

  it("should return 500 when storage.users.getUser throws an error", async () => {
    // Mock storage.users.getUser to throw an error
    const errorMessage = "Database connection failed";
    vi.mocked(storage.users.getUser).mockRejectedValueOnce(new Error(errorMessage));

    const response = await request(app).get("/api/v1/preferences");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" });
    expect(storage.users.getUser).toHaveBeenCalledWith("test_user_id");
  });

  it("serializes nullable opt-in preferences as false", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValueOnce({
      weightUnit: null,
      distanceUnit: null,
      weeklyGoal: null,
      emailNotifications: null,
      emailWeeklySummary: null,
      emailMissedReminder: null,
      showAdherenceInsights: null,
      aiCoachEnabled: null,
      trainingStyleId: null,
      trainingStylePreviousId: null,
      trainingStyleChangedAt: null,
      trainingStyleRecomputeNow: null,
      onboardingCompleted: null,
      mafAge: null,
      mafInjuryIllnessMedication: null,
      mafConsistency: null,
      mafTrend: null,
      mafHrDataAvailable: null,
      mafHr: null,
      mafBaselineTestScheduledAt: null,
    });
    vi.mocked(storage.plans.getActivePlan).mockResolvedValueOnce(null);

    const response = await request(app).get("/api/v1/preferences");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      emailNotifications: false,
      emailWeeklySummary: false,
      emailMissedReminder: false,
      aiCoachEnabled: false,
      onboardingCompleted: false,
    });
  });

  it("returns durable onboarding completion", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValueOnce({
      weightUnit: "kg",
      distanceUnit: "km",
      weeklyGoal: 5,
      emailNotifications: false,
      emailWeeklySummary: false,
      emailMissedReminder: false,
      showAdherenceInsights: true,
      aiCoachEnabled: false,
      trainingStyleId: "balanced_default",
      trainingStylePreviousId: null,
      trainingStyleChangedAt: null,
      trainingStyleRecomputeNow: false,
      onboardingCompleted: true,
      mafAge: null,
      mafInjuryIllnessMedication: null,
      mafConsistency: null,
      mafTrend: null,
      mafHrDataAvailable: null,
      mafHr: null,
      mafBaselineTestScheduledAt: null,
    });
    vi.mocked(storage.plans.getActivePlan).mockResolvedValueOnce(null);

    const response = await request(app).get("/api/v1/preferences");

    expect(response.status).toBe(200);
    expect(response.body.onboardingCompleted).toBe(true);
  });
});

describe("PATCH /api/v1/preferences", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp(preferencesRouter);
    vi.mocked(storage.users.getUser).mockResolvedValue({
      id: "test_user_id",
      mafAge: null,
      mafConsistency: null,
      mafTrend: null,
    });
    vi.mocked(storage.users.updateUserPreferences).mockResolvedValue({
      weightUnit: "kg",
      distanceUnit: "km",
      weeklyGoal: 5,
      emailNotifications: true,
      emailWeeklySummary: true,
      emailMissedReminder: true,
      showAdherenceInsights: true,
      aiCoachEnabled: true,
      trainingStyleId: "maf_method",
      trainingStylePreviousId: null,
      trainingStyleChangedAt: null,
      trainingStyleRecomputeNow: false,
      onboardingCompleted: true,
      mafAge: 39,
      mafInjuryIllnessMedication: false,
      mafConsistency: "moderate",
      mafTrend: "flat",
      mafHrDataAvailable: null,
      mafHr: null,
      mafBaselineTestScheduledAt: null,
    });
  });


  it("returns shared validation contract on invalid body", async () => {
    const response = await request(app).patch("/api/v1/preferences").send({ weeklyGoal: "nope" });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR", message: expect.any(String), details: { issues: expect.any(Array) } });
  });

  it("fails validation when switching to MAF without required MAF fields", async () => {
    const response = await request(app).patch("/api/v1/preferences").send({ trainingStyleId: "maf_method" });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("MAF_SETUP_REQUIRED");
  });

  it("succeeds when switching to MAF with required MAF fields", async () => {
    const response = await request(app).patch("/api/v1/preferences").send({
      trainingStyleId: "maf_method",
      mafAge: 39,
      mafConsistency: "moderate",
      mafTrend: "flat",
    });
    expect(response.status).toBe(200);
    expect(storage.users.updateUserPreferences).toHaveBeenCalled();
  });

  it("allows non-MAF style switch without MAF fields", async () => {
    const response = await request(app).patch("/api/v1/preferences").send({ trainingStyleId: "balanced_default" });
    expect(response.status).toBe(200);
  });

  it("persists onboarding completion when provided", async () => {
    const response = await request(app).patch("/api/v1/preferences").send({ onboardingCompleted: true });

    expect(response.status).toBe(200);
    expect(storage.users.updateUserPreferences).toHaveBeenCalledWith("test_user_id", { onboardingCompleted: true });
    expect(response.body.onboardingCompleted).toBe(true);
  });

  it("does not change onboarding completion when omitted", async () => {
    const response = await request(app).patch("/api/v1/preferences").send({ weeklyGoal: 6 });

    expect(response.status).toBe(200);
    expect(storage.users.updateUserPreferences).toHaveBeenCalledWith("test_user_id", { weeklyGoal: 6 });
    expect(response.body.onboardingCompleted).toBe(true);
  });

  it("rejects an out-of-range resting heart rate", async () => {
    const response = await request(app).patch("/api/v1/preferences").send({ restingHr: 20 });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("persists heart-rate and power baselines when provided", async () => {
    const response = await request(app)
      .patch("/api/v1/preferences")
      .send({ restingHr: 55, maxHr: 185, ftp: 280 });

    expect(response.status).toBe(200);
    expect(storage.users.updateUserPreferences).toHaveBeenCalledWith("test_user_id", {
      restingHr: 55,
      maxHr: 185,
      ftp: 280,
    });
  });

  it("accepts null heart-rate and power baselines to clear stored values", async () => {
    const response = await request(app)
      .patch("/api/v1/preferences")
      .send({ restingHr: null, maxHr: null, ftp: null });

    expect(response.status).toBe(200);
    expect(storage.users.updateUserPreferences).toHaveBeenCalledWith("test_user_id", {
      restingHr: null,
      maxHr: null,
      ftp: null,
    });
  });
});
