import { createTestApp } from "./testUtils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import plansRouter from "../plans";
import { clearRateLimitBuckets } from "../../routeUtils";
import { storage } from "../../storage";

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
    workouts: {
      deleteWorkoutLogByPlanDayId: vi.fn(),
    },
    plans: {
      listTrainingPlans: vi.fn(),
      getTrainingPlan: vi.fn(),
      updatePlanDay: vi.fn(),
      renameTrainingPlan: vi.fn(),
      deleteTrainingPlan: vi.fn(),
      schedulePlan: vi.fn(),
      deletePlanDay: vi.fn(),
    },
  },
}));

// Mock the planService functions
vi.mock("../../queue", () => ({ queue: { send: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../../services/planService", () => ({
  importPlanFromCSV: vi.fn().mockResolvedValue({ id: "mock_plan_id", name: "Mock Plan" }),
  createSamplePlan: vi.fn(),
  updatePlanDayWithCleanup: vi.fn(),
}));

describe("POST /api/plans/import Rate Limiting", () => {
  let app: express.Express;

  beforeEach(() => {
    // We must reset the timer in the rate limiter module if there's any state,
    // but the rate limiter map is internal to routeUtils.ts.
    // So we clear vi timers and clear all mock data.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1));

    app = createTestApp(plansRouter);

  });

  it("should rate limit requests to /api/plans/import after 5 requests", async () => {
    // Generate valid payload
    const payload = {
      csvContent: "Week,Day,Type,Exercise\n1,1,Strength,Squats",
      fileName: "test.csv",
      planName: "Test Plan",
    };

    // First 5 requests should succeed (200 OK)
    for (let i = 0; i < 5; i++) {
      const response = await request(app).post("/api/v1/plans/import").send(payload);
      expect(response.status).toBe(200);
    }

    // 6th request should fail with 429 Too Many Requests
    const rateLimitedResponse = await request(app).post("/api/v1/plans/import").send(payload);
    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.body.error).toContain("Too many requests");
    expect(rateLimitedResponse.headers["retry-after"]).toBeDefined();

    // Fast-forward time past the 60 second window
    vi.advanceTimersByTime(61000);

    // Next request should succeed again
    const successfulResponse = await request(app).post("/api/v1/plans/import").send(payload);
    expect(successfulResponse.status).toBe(200);
  });
});

describe("DELETE /api/v1/plans/:id", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(plansRouter);
  });

  it("should return 200 with success when plan exists", async () => {
    vi.mocked(storage.plans.deleteTrainingPlan).mockResolvedValue(true);

    const response = await request(app).delete("/api/v1/plans/plan-123");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(storage.plans.deleteTrainingPlan).toHaveBeenCalledWith("plan-123", "test_user_id");
  });

  it("should return 404 when plan does not exist", async () => {
    vi.mocked(storage.plans.deleteTrainingPlan).mockResolvedValue(false);

    const response = await request(app).delete("/api/v1/plans/nonexistent");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Training plan not found", code: "NOT_FOUND" });
  });
});
