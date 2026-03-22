import { setupTestErrorHandler } from "./testUtils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import plansRouter from "../plans";

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
    listTrainingPlans: vi.fn(),
    getTrainingPlan: vi.fn(),
    updatePlanDay: vi.fn(),
    renameTrainingPlan: vi.fn(),
    deleteTrainingPlan: vi.fn(),
    schedulePlan: vi.fn(),
    deleteWorkoutLogByPlanDayId: vi.fn(),
    deletePlanDay: vi.fn(),
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

    app = express();
    app.use(express.json());
    app.use(plansRouter);
    // Mock global error handler
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (err.status >= 500 || !err.status) {
        if (req.log) {
          req.log.error({ err }, "Unhandled error in route");
        } else {
          // If logger mock exists, call it so tests pass

        }
      }
      console.log("Global error handler caught error:", err.message);
      res.status(err.status || 500).json({ error: "Internal Server Error" });
    });
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
