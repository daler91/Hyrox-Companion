import express from "express";
import request from "supertest";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../routeUtils";
import { storage } from "../../storage";
import plansRouter from "../plans";
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

vi.mock("../../middleware/aibudget", () => ({
  aiBudgetCheck: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../services/planGenerationService", () => ({
  generatePlan: vi.fn(),
}));

// Mock the storage functions
vi.mock("../../storage", () => ({
  storage: {
    workouts: {
      deleteWorkoutLogByPlanDayId: vi.fn(),
      getExerciseSetsByPlanDay: vi.fn(),
      getWorkoutStructureByPlanDay: vi.fn(),
      mutateExerciseSetUpdate: vi.fn(),
      mutateExerciseSetAdd: vi.fn(),
      mutateExerciseSetDelete: vi.fn(),
    },
    plans: {
      listTrainingPlans: vi.fn(),
      getTrainingPlan: vi.fn(),
      getPlanDay: vi.fn(),
      updatePlanDay: vi.fn(),
      renameTrainingPlan: vi.fn(),
      deleteTrainingPlan: vi.fn(),
      schedulePlan: vi.fn(),
      deletePlanDay: vi.fn(),
    },
    users: {
      getUser: vi.fn(),
      getCustomExercises: vi.fn(),
    },
  },
}));

vi.mock("../../services/structuredExerciseHealth", () => ({ incrementStructuredExerciseCounter: vi.fn().mockResolvedValue(undefined) }));

// Mock the planService functions
vi.mock("../../queue", () => ({ queue: { send: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../../services/planService", () => ({
  importPlanFromCSV: vi.fn().mockResolvedValue({ id: "mock_plan_id", name: "Mock Plan" }),
  createSamplePlan: vi.fn(),
  updatePlanDayWithCleanup: vi.fn(),
}));

vi.mock("../../services/workoutService", () => ({
  deriveMissingPlanDaySetsFromStructure: vi.fn(),
  reparsePlanDay: vi.fn(),
  reparsePlanDayFromImage: vi.fn(),
  replacePlanDayStructure: vi.fn(),
}));

const emptyPlanDayRowsResponse = { exerciseSets: [], structureBlocks: [] };
const generatePlanPayload = {
  goal: "Hyrox race prep",
  totalWeeks: 8,
  daysPerWeek: 5,
  experienceLevel: "intermediate",
};

function mockEmptyPlanDayRows() {
  vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue([] as never);
  vi.mocked(storage.workouts.getWorkoutStructureByPlanDay).mockResolvedValue([] as never);
}

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

describe("POST /api/v1/plans/generate", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(plansRouter);
  });

  it("returns a classified AI error when generation times out upstream", async () => {
    const { generatePlan } = await import("../../services/planGenerationService");
    vi.mocked(generatePlan).mockRejectedValue(new Error("AI call timed out after 90000ms (planGeneration)"));

    const response = await request(app)
      .post("/api/v1/plans/generate")
      .send(generatePlanPayload);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "AI service temporarily unavailable.",
      code: "AI_UNAVAILABLE",
    });
  });
});

describe("plan-day exercise routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(plansRouter);
  });

  it("does not auto-hydrate plan-day rows on read", async () => {
    mockEmptyPlanDayRows();

    const response = await request(app).get("/api/v1/plans/days/day-1/sets?includeStructure=true");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(emptyPlanDayRowsResponse);
    expect(storage.plans.getPlanDay).not.toHaveBeenCalled();
  });

  it("parses the current plan-day text payload and saves it on success", async () => {
    const { reparsePlanDay } = await import("../../services/workoutService");
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue({
      id: "day-1",
      mainWorkout: "old text",
      accessory: "old accessory",
    });
    vi.mocked(storage.users.getUser).mockResolvedValue({ id: "test_user_id", weightUnit: "lb", distanceUnit: "miles" });
    vi.mocked(reparsePlanDay).mockResolvedValue({
      exercises: [{ exerciseName: "back_squat" }],
      saved: true,
      setCount: 1,
      rejectedCount: 0,
      rejectionReasons: [],
    });
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue({ id: "day-1" });

    const response = await request(app)
      .post("/api/v1/plans/days/day-1/reparse")
      .send({ mainWorkout: "new text", accessory: null });

    expect(response.status).toBe(200);
    expect(reparsePlanDay).toHaveBeenCalledWith(
      expect.objectContaining({ id: "day-1", mainWorkout: "new text", accessory: null }),
      { weightUnit: "lb", distanceUnit: "miles" },
    );
    expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
      "day-1",
      { mainWorkout: "new text", accessory: null },
      "test_user_id",
    );
  });
});
