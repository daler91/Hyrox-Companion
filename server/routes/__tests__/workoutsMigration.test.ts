import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkAiBudget } from "../../services/aiUsageService";
import {
  listBackfillReviews,
  resolveBackfillReview,
  runAssistedMigrationBackfill,
} from "../../services/assistedMigrationService";
import { storage } from "../../storage";
import { registerWorkoutMigrationRoutes } from "../workouts/workoutsMigration.routes";
import { createTestApp, resetRouteTestState } from "./testUtils";

const TEST_USER = "test_user_id";

vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: any, _res: any, next: () => void) => { req.auth = { userId: TEST_USER }; next(); },
}));

vi.mock("../../types", () => ({ getUserId: () => TEST_USER }));

vi.mock("../../routeGuards", () => ({
  protectedMutationGuards: [(req: any, _res: any, next: () => void) => { req.auth = { userId: TEST_USER }; next(); }],
}));

vi.mock("../../services/assistedMigrationService", () => ({
  runAssistedMigrationBackfill: vi.fn(),
  listBackfillReviews: vi.fn(),
  resolveBackfillReview: vi.fn(),
}));

// The real aiConsentCheck and aiBudgetCheck run; these are what they read.
vi.mock("../../storage", async () => (await import("./testUtils")).mockStorageModule({ users: ["getUser"] }));

vi.mock("../../services/aiUsageService", () => ({
  DAILY_LIMIT_CENTS: 200,
  checkAiBudget: vi.fn(),
}));

describe("Workout Migration Routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetRouteTestState();
    const router = express.Router();
    registerWorkoutMigrationRoutes(router);
    app = createTestApp(router);
    vi.mocked(storage.users.getUser).mockResolvedValue({ id: TEST_USER, aiCoachEnabled: true } as never);
    vi.mocked(checkAiBudget).mockResolvedValue({ allowed: true, warning: false, currentCostCents: 0, limitCents: 200 });
  });

  describe("POST /api/v1/workouts/migration/backfill", () => {
    it("runs backfill and returns results", async () => {
      const mockResult = { processed: 5, pendingReviews: 2 };
      vi.mocked(runAssistedMigrationBackfill).mockResolvedValueOnce(mockResult as any);

      const response = await request(app).post("/api/v1/workouts/migration/backfill").send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
      expect(runAssistedMigrationBackfill).toHaveBeenCalledWith(TEST_USER);
    });

    // P6 (CODEBASE_ANALYSIS_2026-10-03): every call sends workout and plan
    // text to the AI parser, so it is gated like the other parse routes.
    it("refuses an athlete who has not opted in to AI before any parse", async () => {
      vi.mocked(storage.users.getUser).mockResolvedValueOnce({ id: TEST_USER, aiCoachEnabled: false } as never);

      const response = await request(app).post("/api/v1/workouts/migration/backfill").send();

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("AI_COACH_DISABLED");
      expect(checkAiBudget).not.toHaveBeenCalled();
      expect(runAssistedMigrationBackfill).not.toHaveBeenCalled();
    });

    it("refuses an athlete over the daily AI budget before any parse", async () => {
      vi.mocked(checkAiBudget).mockResolvedValueOnce({ allowed: false, warning: true, currentCostCents: 210, limitCents: 200, deniedBy: "user" });

      const response = await request(app).post("/api/v1/workouts/migration/backfill").send();

      expect(response.status).toBe(429);
      expect(response.body.code).toBe("AI_BUDGET_EXCEEDED");
      expect(checkAiBudget).toHaveBeenCalledWith(TEST_USER);
      expect(runAssistedMigrationBackfill).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/v1/workouts/migration/reviews", () => {
    it.each([
      [{ ownerType: "workoutLog", ownerId: "1" }],
      [{}],
    ])("lists backfill reviews with valid query params: %j", async (query) => {
      const mockReviews = [{ ownerId: "1", ownerType: "workoutLog", status: "needs_manual_review" }];
      vi.mocked(listBackfillReviews).mockResolvedValueOnce(mockReviews as any);

      const response = await request(app).get("/api/v1/workouts/migration/reviews").query(query);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockReviews);
      expect(listBackfillReviews).toHaveBeenCalledWith(TEST_USER, query);
    });

    it.each([
      { ownerType: "workoutLog" },
      { ownerId: "1" }
    ])("returns 400 when missing paired query param: %j", async (query) => {
      const response = await request(app).get("/api/v1/workouts/migration/reviews").query(query);
      expect(response.status).toBe(400);
      expect(response.body.message).toContain("ownerType and ownerId must be provided together");
    });
  });

  describe("POST /api/v1/workouts/migration/reviews/resolve", () => {
    it.each([
      [{ ownerType: "workoutLog", ownerId: "w1", action: "accept" }, "workoutLog", "w1", "resolved", null],
      [{ ownerType: "planDay", ownerId: "p1", action: "edit", reason: "Edited" }, "planDay", "p1", "resolved", "Edited"],
      [{ ownerType: "workoutLog", ownerId: "w2", action: "reject", reason: "bad" }, "workoutLog", "w2", "needs_manual_review", "bad"]
    ])("resolves a review successfully %j", async (payload, type, id, status, reason) => {
      vi.mocked(resolveBackfillReview).mockResolvedValueOnce(true);

      const response = await request(app).post("/api/v1/workouts/migration/reviews/resolve").send(payload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
      expect(resolveBackfillReview).toHaveBeenCalledWith(type, id, TEST_USER, status, reason);
    });

    it("returns 404 when migration review target is not found", async () => {
      vi.mocked(resolveBackfillReview).mockResolvedValueOnce(false);
      const response = await request(app).post("/api/v1/workouts/migration/reviews/resolve").send({ ownerType: "workoutLog", ownerId: "n1", action: "accept" });
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("NOT_FOUND");
    });

    it.each([
      { ownerId: "w1", action: "accept" },
      { ownerType: "workoutLog", ownerId: "w1", action: "invalid_action" }
    ])("returns 400 for invalid payload: %j", async (payload) => {
      const response = await request(app).post("/api/v1/workouts/migration/reviews/resolve").send(payload);
      expect(response.status).toBe(400);
    });
  });
});
