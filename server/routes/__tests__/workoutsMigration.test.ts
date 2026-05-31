import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listBackfillReviews,
  resolveBackfillReview,
  runAssistedMigrationBackfill,
} from "../../services/assistedMigrationService";
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

describe("Workout Migration Routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetRouteTestState();
    const router = express.Router();
    registerWorkoutMigrationRoutes(router);
    app = createTestApp(router);
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
