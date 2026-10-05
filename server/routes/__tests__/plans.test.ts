import { addDaysToISODate, toIsoDateUtc } from "@shared/dateUtils";
import express from "express";
import request from "supertest";
import { afterEach,beforeEach,describe, expect, it, vi } from "vitest";

import { AppError, ErrorCode } from "../../errors";
import { clearRateLimitBuckets } from "../../routeUtils";
import { moveStatementsToCard } from "../../services/athleteFactsService";
import { createPendingPlan } from "../../services/planGenerationService";
import { createSamplePlan, importPlanFromCSV } from "../../services/planService";
import { storage } from "../../storage";
import plansRouter from "../plans";
import { createTestApp } from "./testUtils";

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());

vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());

vi.mock("../../middleware/aibudget", async () => (await import("./testUtils")).mockAiBudgetModule());

vi.mock("../../services/planGenerationService", () => ({
  createPendingPlan: vi.fn(),
}));

vi.mock("../../services/athleteFactsService", () => ({
  moveStatementsToCard: vi.fn(),
}));

const { schedulePlan } = vi.hoisted(() => ({ schedulePlan: vi.fn() }));

vi.mock("../../storage", async () => {
  const mocked = (await import("./testUtils")).mockStorageModule({
    workouts: ["getExerciseSetsByPlanDay", "getWorkoutStructureByPlanDay", "mutateExerciseSetUpdate", "mutateExerciseSetAdd", "mutateExerciseSetDelete"],
    plans: ["listTrainingPlans", "getTrainingPlan", "getPlanDay", "updatePlanDay", "renameTrainingPlan", "deleteTrainingPlan", "deletePlanDay", "hasInFlightPlanGeneration", "updateGenerationStatus", "setPlanRetirement", "findOverlappingActivePlans"],
    users: ["getUser", "getCustomExercises", "updateUserPreferences"],
  });
  return { storage: { ...mocked.storage, plans: { ...mocked.storage.plans, schedulePlan } } };
});

vi.mock("../../services/structuredExerciseHealth", () => ({ incrementStructuredExerciseCounter: vi.fn().mockResolvedValue(undefined) }));

// Mock the planService functions
vi.mock("../../queue", () => ({
  queue: { send: vi.fn().mockResolvedValue(undefined), sendDebounced: vi.fn().mockResolvedValue(null) },
  sendJobNoRetry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/planService", () => ({
  importPlanFromCSV: vi.fn().mockResolvedValue({ id: "mock_plan_id", name: "Mock Plan" }),
  createSamplePlan: vi.fn(),
  updatePlanDayWithCleanup: vi.fn(),
  updatePlanDayStatus: vi.fn(),
  updatePlanDayRecordingMove: vi.fn(),
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

// C34 (CODEBASE_ANALYSIS_2026-10-03): every import failure used to come back
// as "Failed to parse CSV content", hiding the row the athlete had to fix.
describe("POST /api/v1/plans/import errors", () => {
  let app: express.Express;
  const payload = { csvContent: "Week,Day\n-40,Monday", fileName: "plan.csv" };

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(plansRouter);
  });

  it("passes the service's own row error through", async () => {
    const rowError = "CSV contains 1 row(s) with a Week below 1 (e.g., -40). Weeks start at 1.";
    vi.mocked(importPlanFromCSV).mockRejectedValueOnce(new AppError(ErrorCode.VALIDATION_ERROR, rowError, 400));

    const response = await request(app).post("/api/v1/plans/import").send(payload);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: rowError, code: "INVALID_CSV" });
  });

  it("keeps an unexpected failure generic", async () => {
    vi.mocked(importPlanFromCSV).mockRejectedValueOnce(new Error("connection terminated unexpectedly"));

    const response = await request(app).post("/api/v1/plans/import").send(payload);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Failed to parse CSV content. Please ensure it follows the expected template format.",
      code: "INVALID_CSV",
    });
  });
});

describe("GET /api/v1/plans/:id", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(plansRouter);
  });

  it("returns the athlete's plan, looked up by id and user", async () => {
    const plan = { id: "plan-123", userId: "test_user_id", name: "Race Block", days: [] };
    vi.mocked(storage.plans.getTrainingPlan).mockResolvedValue(plan as never);

    const response = await request(app).get("/api/v1/plans/plan-123");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(plan);
    expect(storage.plans.getTrainingPlan).toHaveBeenCalledWith("plan-123", "test_user_id");
  });

  it("returns 404 for a plan the athlete does not own", async () => {
    vi.mocked(storage.plans.getTrainingPlan).mockResolvedValue(undefined);

    const response = await request(app).get("/api/v1/plans/plan-123");

    expect(response.status).toBe(404);
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
    vi.mocked(storage.plans.deleteTrainingPlan).mockResolvedValue({ recycleBinItemId: "rb-1" });

    const response = await request(app).delete("/api/v1/plans/plan-123");

    expect(response.status).toBe(200);
    // The bin item id is what the client's Undo toast posts back to restore.
    expect(response.body).toEqual({ success: true, recycleBinItemId: "rb-1" });
    expect(storage.plans.deleteTrainingPlan).toHaveBeenCalledWith("plan-123", "test_user_id");
  });

  it("should return 404 when plan does not exist", async () => {
    vi.mocked(storage.plans.deleteTrainingPlan).mockResolvedValue(null);

    const response = await request(app).delete("/api/v1/plans/nonexistent");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Training plan not found", code: "NOT_FOUND" });
  });
});

describe("POST /api/v1/plans/sample", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(plansRouter);
    vi.mocked(createSamplePlan).mockResolvedValue({ id: "sample-1" } as never);
  });

  it("creates the template with no body, as the Timeline does", async () => {
    const response = await request(app).post("/api/v1/plans/sample").send({});

    expect(response.status).toBe(200);
    expect(createSamplePlan).toHaveBeenCalledWith("test_user_id", {});
  });

  // Onboarding keeps the goal and race date template users give (audit M3).
  it("passes onboarding's goal and race date through", async () => {
    const raceDate = addDaysToISODate(toIsoDateUtc(new Date()), 42);
    const response = await request(app)
      .post("/api/v1/plans/sample")
      .send({ goal: "Complete HYROX Open", raceDate });

    expect(response.status).toBe(200);
    expect(createSamplePlan).toHaveBeenCalledWith("test_user_id", {
      goal: "Complete HYROX Open",
      raceDate,
    });
  });

  // A past race made the whole template post-race recovery (CL9, CODEBASE_ANALYSIS_2026-10-03).
  it.each(["15/11/2026", "2025-11-15"])("rejects a malformed or past race date (%s)", async (raceDate) => {
    const response = await request(app).post("/api/v1/plans/sample").send({ raceDate });

    expect(response.status).toBe(400);
    expect(createSamplePlan).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/plans/:planId/schedule", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(plansRouter);
  });

  it("schedules the athlete's plan from the chosen date", async () => {
    schedulePlan.mockResolvedValue("scheduled");

    const response = await request(app)
      .post("/api/v1/plans/plan-123/schedule")
      .send({ startDate: "2026-09-23" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(schedulePlan).toHaveBeenCalledWith("plan-123", "2026-09-23", "test_user_id");
  });

  it("returns 404 for a plan the athlete does not own", async () => {
    schedulePlan.mockResolvedValue("not_found");

    const response = await request(app)
      .post("/api/v1/plans/plan-123/schedule")
      .send({ startDate: "2026-09-23" });

    expect(response.status).toBe(404);
  });

  // Sessions are never placed before the start date (onboarding audit C3).
  it("explains a start date after every session of the plan", async () => {
    schedulePlan.mockResolvedValue("nothing_after_start");

    const response = await request(app)
      .post("/api/v1/plans/plan-123/schedule")
      .send({ startDate: "2026-09-27" });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("code", "NO_SESSIONS_AFTER_START");
    expect(response.text).toMatch(/earlier start date/);
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

  it("maps the DB unique-violation loser of a concurrent generate race to the same 409", async () => {
    // hasInFlightPlanGeneration's SELECT is check-then-act: two concurrent
    // requests can both pass it. The uq_training_plans_user_in_flight index
    // (migration 0091) fails the loser's INSERT with 23505 — the route must
    // surface that as PLAN_GENERATION_IN_PROGRESS, not a 500, and must not
    // enqueue a job.
    const { createPendingPlan } = await import("../../services/planGenerationService");
    const { sendJobNoRetry } = await import("../../queue");
    const uniqueViolation = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "uq_training_plans_user_in_flight",
    });
    vi.mocked(createPendingPlan).mockRejectedValue(uniqueViolation);

    const response = await request(app)
      .post("/api/v1/plans/generate")
      .send(generatePlanPayload);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PLAN_GENERATION_IN_PROGRESS");
    expect(sendJobNoRetry).not.toHaveBeenCalled();
  });

  it("detects the unique violation through a drizzle-style cause chain", async () => {
    const { createPendingPlan } = await import("../../services/planGenerationService");
    const wrapped = new Error("Failed query: insert into training_plans ...");
    (wrapped as Error & { cause?: unknown }).cause = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "uq_training_plans_user_in_flight",
    });
    vi.mocked(createPendingPlan).mockRejectedValue(wrapped);

    const response = await request(app)
      .post("/api/v1/plans/generate")
      .send(generatePlanPayload);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PLAN_GENERATION_IN_PROGRESS");
  });

  it("does not swallow an unrelated unique violation as an in-flight conflict", async () => {
    const { createPendingPlan } = await import("../../services/planGenerationService");
    vi.mocked(createPendingPlan).mockRejectedValue(
      Object.assign(new Error("duplicate key"), { code: "23505", constraint: "some_other_index" }),
    );

    const response = await request(app)
      .post("/api/v1/plans/generate")
      .send(generatePlanPayload);

    expect(response.status).toBe(500);
  });

  it("puts the athlete's injuries on their card, where every coach prompt and later plan reads them", async () => {
    // The generator once asked for this and threw it away; then it kept one
    // free-text note. Now each sentence is a fact on the athlete card
    // (moveStatementsToCard is tested on its own).
    vi.mocked(moveStatementsToCard).mockResolvedValue({ added: 1, skipped: 0 });

    await request(app)
      .post("/api/v1/plans/generate")
      .send({ ...generatePlanPayload, injuries: "  Recovering from knee injury  " });

    expect(moveStatementsToCard).toHaveBeenCalledWith("test_user_id", "  Recovering from knee injury  ", "plan_generation");
  });

  it("hands even an empty box over, so a cleared older note is dropped, but nothing from a client that never sends one", async () => {
    // The box arrives prefilled with the older free-text note; clearing it is
    // how the athlete says it no longer applies. A client that never sends the
    // field must change nothing.
    vi.mocked(moveStatementsToCard).mockResolvedValue({ added: 0, skipped: 0 });
    await request(app).post("/api/v1/plans/generate").send({ ...generatePlanPayload, injuries: "   " });
    // generatePlanPayload carries no injuries field at all.
    await request(app).post("/api/v1/plans/generate").send(generatePlanPayload);

    expect(vi.mocked(moveStatementsToCard).mock.calls).toEqual([["test_user_id", "   ", "plan_generation"]]);
  });

  it("still generates the plan when the card can't be written", async () => {
    vi.mocked(moveStatementsToCard).mockRejectedValue(new Error("db down"));

    await request(app).post("/api/v1/plans/generate").send({ ...generatePlanPayload, injuries: "Bad left knee" });

    expect(createPendingPlan).toHaveBeenCalled();
  });

  it("fails the stub when the job cannot be enqueued, so it does not block the athlete's retry (D20)", async () => {
    // With no job behind it, a pending stub held uq_training_plans_user_in_flight
    // and every retry answered 409 until the stale-generation sweep reached it.
    const { createPendingPlan } = await import("../../services/planGenerationService");
    const { sendJobNoRetry } = await import("../../queue");
    vi.mocked(createPendingPlan).mockResolvedValue({ id: "plan-1", generationStatus: "pending", days: [] } as never);
    vi.mocked(sendJobNoRetry).mockRejectedValueOnce(new Error("pg-boss unavailable"));
    vi.mocked(storage.plans.updateGenerationStatus).mockResolvedValue(undefined);

    const response = await request(app)
      .post("/api/v1/plans/generate")
      .send(generatePlanPayload);

    expect(response.status).toBe(500);
    expect(storage.plans.updateGenerationStatus).toHaveBeenCalledWith("plan-1", "failed", expect.any(String));
  });

  it("still reports the enqueue failure when the stub cannot be marked failed either", async () => {
    const { createPendingPlan } = await import("../../services/planGenerationService");
    const { sendJobNoRetry } = await import("../../queue");
    vi.mocked(createPendingPlan).mockResolvedValue({ id: "plan-1", generationStatus: "pending", days: [] } as never);
    vi.mocked(sendJobNoRetry).mockRejectedValueOnce(new Error("pg-boss unavailable"));
    vi.mocked(storage.plans.updateGenerationStatus).mockRejectedValueOnce(new Error("db down"));

    const response = await request(app)
      .post("/api/v1/plans/generate")
      .send(generatePlanPayload);

    expect(response.status).toBe(500);
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
      "test_user_id",
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
    expect(replacePlanDayStructure).toHaveBeenCalledWith("day-1", "test_user_id", [], []);
  });

  // Relinks (CL15) are covered in planDayStructure.test.ts.

  describe("set writes carry the units they were composed in (D22, CODEBASE_ANALYSIS_2026-10-03)", () => {
    const PLAN_DAY = { kind: "planDay", ownerId: "day-1" };

    beforeEach(() => {
      // The athlete has switched to lbs on another device.
      vi.mocked(storage.users.getUser).mockResolvedValue({ id: "test_user_id", weightUnit: "lbs", distanceUnit: "miles" });
      vi.mocked(storage.workouts.mutateExerciseSetUpdate).mockResolvedValue({ id: "set-1" } as never);
    });

    it("stamps a PATCH composed in kg as kg while the stored preference is lbs", async () => {
      const response = await request(app)
        .patch("/api/v1/plans/days/day-1/sets/set-1")
        .send({ weight: 100, weightUnit: "kg" });

      expect(response.status).toBe(200);
      expect(storage.workouts.mutateExerciseSetUpdate).toHaveBeenCalledWith(
        PLAN_DAY,
        "set-1",
        { weight: 100, unitPreferences: { weightUnit: "kg", distanceUnit: "miles" } },
        "test_user_id",
      );
    });

    it("reads a PATCH without units in the stored preference, as before", async () => {
      const response = await request(app).patch("/api/v1/plans/days/day-1/sets/set-1").send({ weight: 225 });

      expect(response.status).toBe(200);
      expect(storage.workouts.mutateExerciseSetUpdate).toHaveBeenCalledWith(
        PLAN_DAY,
        "set-1",
        { weight: 225, unitPreferences: { weightUnit: "lbs", distanceUnit: "miles" } },
        "test_user_id",
      );
    });

    it("rejects a unit outside the preference enum", async () => {
      const response = await request(app)
        .patch("/api/v1/plans/days/day-1/sets/set-1")
        .send({ weight: 100, weightUnit: "stone" });

      expect(response.status).toBe(400);
      expect(storage.workouts.mutateExerciseSetUpdate).not.toHaveBeenCalled();
    });
  });
});
