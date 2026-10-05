import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../routeUtils";
import { invalidateAnalyticsCachesForUser } from "../../services/analyticsRouteCache";
import plansRouter from "../plans";
import { createTestApp, TEST_USER_ID } from "./testUtils";

/**
 * D10 (CODEBASE_ANALYSIS_2026-10-03): deleting a plan or a plan day sets
 * workout_logs.plan_day_id to NULL on the athlete's logs, and the analytics
 * routes cache those logs for minutes. Reopening a completed day (which
 * deletes its log) invalidates inside updatePlanDayStatus, covered in
 * planService.reopenAnalytics.test.ts.
 */

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());
vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());
vi.mock("../../middleware/aibudget", async () =>
  (await import("./testUtils")).mockAiBudgetModule(),
);
const { deleteTrainingPlan, deletePlanDay } = vi.hoisted(() => ({
  deleteTrainingPlan: vi.fn(),
  deletePlanDay: vi.fn(),
}));
vi.mock("../../storage", () => ({
  storage: { plans: { deleteTrainingPlan, deletePlanDay }, users: { getUser: vi.fn() } },
}));
vi.mock("../../queue", () => ({
  queue: {
    send: vi.fn().mockResolvedValue(undefined),
    sendDebounced: vi.fn().mockResolvedValue(null),
  },
  sendJobNoRetry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/analyticsRouteCache", () => ({
  invalidateAnalyticsCachesForUser: vi.fn(),
}));
vi.mock("../../services/planGenerationService", () => ({ createPendingPlan: vi.fn() }));
vi.mock("../../services/athleteFactsService", () => ({ moveStatementsToCard: vi.fn() }));
vi.mock("../../services/planService", () => ({
  importPlanFromCSV: vi.fn(),
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

describe("plan deletes drop the athlete's cached analytics (D10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
  });

  it("invalidates after deleting a plan", async () => {
    deleteTrainingPlan.mockResolvedValue({ recycleBinItemId: "rb-1" });

    const res = await request(createTestApp(plansRouter)).delete("/api/v1/plans/plan-1");

    expect(res.status).toBe(200);
    expect(invalidateAnalyticsCachesForUser).toHaveBeenCalledWith(TEST_USER_ID);
  });

  it("invalidates after deleting a plan day", async () => {
    deletePlanDay.mockResolvedValue({ recycleBinItemId: "rb-2" });

    const res = await request(createTestApp(plansRouter)).delete("/api/v1/plans/days/day-1");

    expect(res.status).toBe(200);
    expect(invalidateAnalyticsCachesForUser).toHaveBeenCalledWith(TEST_USER_ID);
  });

  it.each([
    ["a plan", "/api/v1/plans/plan-1"],
    ["a plan day", "/api/v1/plans/days/day-1"],
  ])("leaves the caches alone when deleting %s found nothing", async (_label, path) => {
    deleteTrainingPlan.mockResolvedValue(null);
    deletePlanDay.mockResolvedValue(null);

    const res = await request(createTestApp(plansRouter)).delete(path);

    expect(res.status).toBe(404);
    expect(invalidateAnalyticsCachesForUser).not.toHaveBeenCalled();
  });
});
