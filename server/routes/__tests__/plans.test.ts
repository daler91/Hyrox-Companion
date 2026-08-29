import express from "express";
import request from "supertest";
import { afterEach,beforeEach,describe, expect, it, vi } from "vitest";

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
  createPendingPlan: vi.fn(),
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
      hasInFlightPlanGeneration: vi.fn(),
      setPlanRetirement: vi.fn(),
      findOverlappingActivePlans: vi.fn(),
    },
    users: {
      getUser: vi.fn(),
      getCustomExercises: vi.fn(),
      updateUserPreferences: vi.fn(),
    },
  },
}));

vi.mock("../../services/structuredExerciseHealth", () => ({ incrementStructuredExerciseCounter: vi.fn().mockResolvedValue(undefined) }));

// Mock the planService functions
vi.mock("../../queue", () => ({
  queue: { send: vi.fn().mockResolvedValue(undefined) },
  sendJobNoRetry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/planService", () => ({
  importPlanFromCSV: vi.fn().mockResolvedValue({ id: "mock_plan_id", name: "Mock Plan" }),
  createSamplePlan: vi.fn(),
  updatePlanDayWithCleanup: vi.fn(),
  updatePlanDayStatus: vi.fn(),
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
  daysPerWeek: 5,
  experienceLevel: "intermediate",
  startDate: "2026-05-04",
  endDate: "2026-06-29", // 56-day span → 8-week plan
  endDateIsRaceDate: true,
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

describe("PATCH /api/v1/plans/:id/retirement", () => {
  let app: express.Express;

  const plan = {
    id: "plan-123",
    userId: "test_user_id",
    name: "Race Block",
    startDate: "2026-01-05",
    endDate: "2026-03-01",
    retiredOn: null,
    days: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(plansRouter);
    vi.mocked(storage.plans.getTrainingPlan).mockResolvedValue(plan as never);
    vi.mocked(storage.users.getUser).mockResolvedValue({ userTimezone: "UTC" } as never);
    vi.mocked(storage.plans.findOverlappingActivePlans).mockResolvedValue([]);
    vi.mocked(storage.plans.setPlanRetirement).mockImplementation(
      async (_id, retiredOn) => ({ ...plan, retiredOn }) as never,
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-10T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("archives from a future date as given", async () => {
    const response = await request(app)
      .patch("/api/v1/plans/plan-123/retirement")
      .send({ retiredOn: "2026-02-20" });

    expect(response.status).toBe(200);
    expect(storage.plans.setPlanRetirement).toHaveBeenCalledWith(
      "plan-123",
      "2026-02-20",
      "test_user_id",
    );
  });

  it("clamps a back-dated retirement forward to today", async () => {
    // A past cutoff would strand every day the sweep already flipped to
    // `missed` between then and now: still red on the timeline, but dropped
    // from the adherence denominator, with no way back (missed → planned is
    // forbidden).
    const response = await request(app)
      .patch("/api/v1/plans/plan-123/retirement")
      .send({ retiredOn: "2026-01-15" });

    expect(response.status).toBe(200);
    expect(storage.plans.setPlanRetirement).toHaveBeenCalledWith(
      "plan-123",
      "2026-02-10",
      "test_user_id",
    );
  });

  it("clamps against the athlete's own calendar, not UTC", async () => {
    // 2026-02-10T00:00Z is still 2026-02-09 in Los Angeles; clamping to the UTC
    // date would retire the plan a day early for that athlete.
    vi.mocked(storage.users.getUser).mockResolvedValue({
      userTimezone: "America/Los_Angeles",
    } as never);

    await request(app)
      .patch("/api/v1/plans/plan-123/retirement")
      .send({ retiredOn: "2026-01-15" });

    expect(storage.plans.setPlanRetirement).toHaveBeenCalledWith(
      "plan-123",
      "2026-02-09",
      "test_user_id",
    );
  });

  it("restores a plan when nothing else covers its dates", async () => {
    const response = await request(app)
      .patch("/api/v1/plans/plan-123/retirement")
      .send({ retiredOn: null });

    expect(response.status).toBe(200);
    expect(storage.plans.setPlanRetirement).toHaveBeenCalledWith(
      "plan-123",
      null,
      "test_user_id",
    );
  });

  it("refuses a restore that would put two live plans over the same days", async () => {
    vi.mocked(storage.plans.findOverlappingActivePlans).mockResolvedValue([
      { id: "plan-999", name: "Base Block" },
    ] as never);

    const response = await request(app)
      .patch("/api/v1/plans/plan-123/retirement")
      .send({ retiredOn: null });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PLAN_OVERLAP");
    expect(response.body.error).toContain("Base Block");
    expect(storage.plans.setPlanRetirement).not.toHaveBeenCalled();
  });

  it("returns 404 for a plan the athlete does not own", async () => {
    vi.mocked(storage.plans.getTrainingPlan).mockResolvedValue(undefined);

    const response = await request(app)
      .patch("/api/v1/plans/plan-123/retirement")
      .send({ retiredOn: null });

    expect(response.status).toBe(404);
    expect(storage.plans.setPlanRetirement).not.toHaveBeenCalled();
  });

  it("rejects a malformed date", async () => {
    const response = await request(app)
      .patch("/api/v1/plans/plan-123/retirement")
      .send({ retiredOn: "not-a-date" });

    expect(response.status).toBe(400);
    expect(storage.plans.setPlanRetirement).not.toHaveBeenCalled();
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
    vi.mocked(storage.users.getUser).mockResolvedValue({ id: "test_user_id", aiCoachEnabled: true, weightUnit: "kg", distanceUnit: "km" });
    vi.mocked(storage.plans.hasInFlightPlanGeneration).mockResolvedValue(false);
    app = createTestApp(plansRouter);
  });

  it("requires AI consent before generating a plan", async () => {
    const { createPendingPlan } = await import("../../services/planGenerationService");
    vi.mocked(storage.users.getUser).mockResolvedValueOnce({ id: "test_user_id", aiCoachEnabled: false });

    const response = await request(app)
      .post("/api/v1/plans/generate")
      .send(generatePlanPayload);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("AI_COACH_DISABLED");
    expect(createPendingPlan).not.toHaveBeenCalled();
  });

  it("returns 202 with stub plan and enqueues a background job", async () => {
    const { createPendingPlan } = await import("../../services/planGenerationService");
    const { sendJobNoRetry } = await import("../../queue");
    const stubPlan = { id: "plan-1", name: "AI Plan: Hyrox race prep", generationStatus: "pending", generationError: null, days: [] };
    vi.mocked(createPendingPlan).mockResolvedValue(stubPlan);

    const response = await request(app)
      .post("/api/v1/plans/generate")
      .send(generatePlanPayload);

    expect(response.status).toBe(202);
    expect(response.body.id).toBe("plan-1");
    expect(response.body.generationStatus).toBe("pending");
    expect(sendJobNoRetry).toHaveBeenCalledWith(
      "plan-generation",
      expect.objectContaining({ planId: "plan-1", userId: "test_user_id" }),
    );
  });

  it("remembers the athlete's injuries on their profile", async () => {
    // The generator has always asked for this and always discarded it, so every
    // regeneration asked again.
    await request(app)
      .post("/api/v1/plans/generate")
      .send({ ...generatePlanPayload, injuries: "  Recovering from knee injury  " });

    expect(storage.users.updateUserPreferences).toHaveBeenCalledWith("test_user_id", {
      trainingConstraints: "Recovering from knee injury",
    });
  });

  it("forgets them when the athlete clears the box", async () => {
    // A resolved constraint has to be forgettable. Storing "" or skipping the
    // write would leave a healed injury shaping every future plan.
    await request(app)
      .post("/api/v1/plans/generate")
      .send({ ...generatePlanPayload, injuries: "   " });

    expect(storage.users.updateUserPreferences).toHaveBeenCalledWith("test_user_id", {
      trainingConstraints: null,
    });
  });

  it("leaves the profile untouched when the field is absent", async () => {
    // An older client that never sends the field must not clear what the
    // athlete already told us.
    const { injuries: _omitted, ...withoutInjuries } = { ...generatePlanPayload, injuries: "x" };

    await request(app).post("/api/v1/plans/generate").send(withoutInjuries);

    expect(storage.users.updateUserPreferences).not.toHaveBeenCalled();
  });

  it("returns 409 and does not enqueue a job when a generation is already in flight (W13)", async () => {
    const { createPendingPlan } = await import("../../services/planGenerationService");
    const { sendJobNoRetry } = await import("../../queue");
    vi.mocked(storage.plans.hasInFlightPlanGeneration).mockResolvedValue(true);

    const response = await request(app)
      .post("/api/v1/plans/generate")
      .send(generatePlanPayload);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PLAN_GENERATION_IN_PROGRESS");
    expect(createPendingPlan).not.toHaveBeenCalled();
    expect(sendJobNoRetry).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/plans/days/:dayId/status", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(plansRouter);
  });

  it("passes a valid skip reason through to the service", async () => {
    const { updatePlanDayStatus } = await import("../../services/planService");
    vi.mocked(updatePlanDayStatus).mockResolvedValue({ id: "day-1", status: "skipped" } as never);

    const response = await request(app)
      .patch("/api/v1/plans/days/day-1/status")
      .send({ status: "skipped", skipReason: "low_energy" });

    expect(response.status).toBe(200);
    expect(updatePlanDayStatus).toHaveBeenCalledWith(
      "day-1",
      expect.objectContaining({ status: "skipped", skipReason: "low_energy" }),
      "test_user_id",
    );
  });

  it("rejects a skip reason outside the enum", async () => {
    const { updatePlanDayStatus } = await import("../../services/planService");

    const response = await request(app)
      .patch("/api/v1/plans/days/day-1/status")
      .send({ status: "skipped", skipReason: "couldnt-be-bothered" });

    expect(response.status).toBe(400);
    expect(updatePlanDayStatus).not.toHaveBeenCalled();
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

  it("returns the raw exercise-set array when includeStructure is omitted", async () => {
    const sets = [{ id: "set-1", exerciseName: "back_squat" }];
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue(sets as never);

    const response = await request(app).get("/api/v1/plans/days/day-1/sets");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(sets);
    // The structure table shouldn't be touched on this leaner, no-structure path.
    expect(storage.workouts.getWorkoutStructureByPlanDay).not.toHaveBeenCalled();
  });

  it("404s when the plan day is not owned by the user and includeStructure is omitted", async () => {
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue(null);

    const response = await request(app).get("/api/v1/plans/days/day-1/sets");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: "Plan day not found" });
  });

  it("404s when includeStructure=true and the plan day is not owned by the user", async () => {
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue(null);
    vi.mocked(storage.workouts.getWorkoutStructureByPlanDay).mockResolvedValue([] as never);

    const response = await request(app).get("/api/v1/plans/days/day-1/sets?includeStructure=true");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: "Plan day not found" });
  });

  it("derives sets from structure blocks and re-reads both tables when sets are empty but structure exists", async () => {
    const { deriveMissingPlanDaySetsFromStructure } = await import("../../services/workoutService");
    const structureBlocks = [{ id: "block-1", sectionType: "warmup", formatType: "steady", steps: [] }];
    const derivedSets = [{ id: "set-1", exerciseName: "burpees" }];

    vi.mocked(storage.workouts.getExerciseSetsByPlanDay)
      .mockResolvedValueOnce([] as never) // first read: no sets yet
      .mockResolvedValueOnce(derivedSets as never); // re-read after deriving
    vi.mocked(storage.workouts.getWorkoutStructureByPlanDay).mockResolvedValue(structureBlocks as never);

    const response = await request(app).get("/api/v1/plans/days/day-1/sets?includeStructure=true");

    expect(response.status).toBe(200);
    expect(deriveMissingPlanDaySetsFromStructure).toHaveBeenCalledWith("day-1", "test_user_id");
    expect(response.body).toEqual({ exerciseSets: derivedSets, structureBlocks });
    expect(storage.workouts.getExerciseSetsByPlanDay).toHaveBeenCalledTimes(2);
  });

  it("parses the current plan-day text payload and saves it on success", async () => {
    const { reparsePlanDay } = await import("../../services/workoutService");
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue({
      id: "day-1",
      mainWorkout: "old text",
      accessory: "old accessory",
    });
    vi.mocked(storage.users.getUser).mockResolvedValue({ id: "test_user_id", aiCoachEnabled: true, weightUnit: "lb", distanceUnit: "miles" });
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

  it("rejects structure writes with 403 when the EMOM builder is disabled (W20)", async () => {
    const { replacePlanDayStructure } = await import("../../services/workoutService");
    const validBlock = {
      sectionType: "warmup",
      formatType: "steady",
      steps: [{ stepNumber: 1, stepType: "work", exerciseName: "Burpees" }],
    };

    const response = await request(app)
      .patch("/api/v1/plans/days/day-1/structure")
      .send({ structureBlocks: [validBlock] });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: "EMOM_BUILDER_DISABLED" });
    expect(replacePlanDayStructure).not.toHaveBeenCalled();
  });

  it("allows empty structure writes regardless of the EMOM flag (W20)", async () => {
    const { replacePlanDayStructure } = await import("../../services/workoutService");
    vi.mocked(replacePlanDayStructure).mockResolvedValue(emptyPlanDayRowsResponse);

    const response = await request(app)
      .patch("/api/v1/plans/days/day-1/structure")
      .send({ structureBlocks: [] });

    expect(response.status).toBe(200);
    expect(replacePlanDayStructure).toHaveBeenCalledWith("day-1", "test_user_id", []);
  });
});
