import express from "express";
import request from "supertest";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { enqueueTrainingStyleRecompute } from "../../services/analyticsRecomputeScheduler";
import { storage } from "../../storage";
import preferencesRouter from "../preferences";
import { createTestApp } from "./testUtils";

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());

vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());

vi.mock("../../storage", async () =>
  (await import("./testUtils")).mockStorageModule({
    users: ["getUser", "updateUserPreferences"],
    plans: ["getActivePlan", "getPlanWeeklyDensity"],
  }),
);

vi.mock("../../services/analyticsRecomputeScheduler", () => ({
  enqueueTrainingStyleRecompute: vi.fn().mockResolvedValue(1),
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
      emailWeeklyReviewReminder: null,
      emailTodaySession: null,
      emailAnalysisDigest: null,
      notifyHour: null,
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
    mafCategory: null,
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
      emailWeeklyReviewReminder: false,
      emailTodaySession: false,
      emailAnalysisDigest: false,
      notifyHour: 7,
      // A stored null stays null on the wire: it is the "follow the default
      // send time" state, not an hour.
      notifyHourWeeklySummary: null,
      notifyHourMissedReminder: null,
      notifyHourWeeklyReviewReminder: null,
      notifyHourTodaySession: null,
      notifyHourAnalysisDigest: null,
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
    mafCategory: null,
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
    mafCategory: null,
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

  it("rejects a notify hour outside 0-23", async () => {
    const response = await request(app).patch("/api/v1/preferences").send({ notifyHour: 24 });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("persists the notify hour and the new email toggles when provided", async () => {
    const response = await request(app)
      .patch("/api/v1/preferences")
      .send({ notifyHour: 18, emailTodaySession: true, emailAnalysisDigest: true });

    expect(response.status).toBe(200);
    expect(storage.users.updateUserPreferences).toHaveBeenCalledWith("test_user_id", {
      notifyHour: 18,
      emailTodaySession: true,
      emailAnalysisDigest: true,
    });
  });

  it("rejects a per-email send hour outside 0-23", async () => {
    const response = await request(app)
      .patch("/api/v1/preferences")
      .send({ notifyHourWeeklySummary: 24 });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("persists per-email send hours, and a null that puts one back on the default", async () => {
    const response = await request(app)
      .patch("/api/v1/preferences")
      .send({ notifyHourWeeklySummary: 9, notifyHourTodaySession: 19, notifyHourAnalysisDigest: null });

    expect(response.status).toBe(200);
    expect(storage.users.updateUserPreferences).toHaveBeenCalledWith("test_user_id", {
      notifyHourWeeklySummary: 9,
      notifyHourTodaySession: 19,
      notifyHourAnalysisDigest: null,
    });
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

  describe("training-style refresh (A1)", () => {
    function storedStyle(trainingStyleId: string) {
      vi.mocked(storage.users.getUser).mockResolvedValue({
        id: "test_user_id",
        trainingStyleId,
        mafAge: 39,
        mafConsistency: "moderate",
        mafTrend: "flat",
        mafCategory: null,
      });
    }

    it("queues a Coach Insights refresh when the client asks for a recompute and stores the flag as false", async () => {
      storedStyle("balanced_default");

      const response = await request(app)
        .patch("/api/v1/preferences")
        .send({ trainingStyleId: "maf_method", trainingStyleRecomputeNow: true });

      expect(response.status).toBe(200);
      expect(storage.users.updateUserPreferences).toHaveBeenCalledWith("test_user_id", {
        trainingStyleId: "maf_method",
        trainingStyleRecomputeNow: false,
      });
      expect(vi.mocked(enqueueTrainingStyleRecompute)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(enqueueTrainingStyleRecompute)).toHaveBeenCalledWith(
        storage,
        "test_user_id",
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
    });

    it("queues the refresh for a style switch even without the flag", async () => {
      storedStyle("balanced_default");

      const response = await request(app).patch("/api/v1/preferences").send({ trainingStyleId: "maf_method" });

      expect(response.status).toBe(200);
      expect(vi.mocked(enqueueTrainingStyleRecompute)).toHaveBeenCalledTimes(1);
    });

    it("does not queue a refresh when the style is unchanged", async () => {
      storedStyle("maf_method");

      const response = await request(app).patch("/api/v1/preferences").send({ weeklyGoal: 6 });

      expect(response.status).toBe(200);
      expect(vi.mocked(enqueueTrainingStyleRecompute)).not.toHaveBeenCalled();
    });

    it("still saves when queueing the refresh fails", async () => {
      storedStyle("balanced_default");
      vi.mocked(enqueueTrainingStyleRecompute).mockRejectedValueOnce(new Error("queue down"));

      const response = await request(app)
        .patch("/api/v1/preferences")
        .send({ trainingStyleId: "maf_method", trainingStyleRecomputeNow: true });

      expect(response.status).toBe(200);
    });
  });
});
