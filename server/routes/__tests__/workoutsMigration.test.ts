import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  listBackfillReviews,
  resolveBackfillReview,
  runAssistedMigrationBackfill} from "../../services/assistedMigrationService";
import { registerWorkoutMigrationRoutes } from "../workouts/workoutsMigration.routes";
import { createTestApp, resetRouteTestState } from "./testUtils";

const { TEST_USER_ID } = vi.hoisted(() => ({ TEST_USER_ID: "test_user_id" }));

vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: any, _res: any, next: () => void) => {
    req.auth = { userId: TEST_USER_ID };
    next();
  },
}));

vi.mock("../../types", () => ({
  getUserId: vi.fn().mockReturnValue(TEST_USER_ID),
}));

vi.mock("../../routeGuards", () => ({
  protectedMutationGuards: [
    (req: any, res: any, next: () => void) => {
      req.auth = { userId: TEST_USER_ID };
      next();
    }
  ],
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
      expect(runAssistedMigrationBackfill).toHaveBeenCalledWith(TEST_USER_ID);
    });
  });

  describe("GET /api/v1/workouts/migration/reviews", () => {
    it("lists backfill reviews with valid query params", async () => {
      const mockReviews = [{ ownerId: "1", ownerType: "workoutLog", status: "needs_manual_review" }];
      vi.mocked(listBackfillReviews).mockResolvedValueOnce(mockReviews as any);

      const response = await request(app)
        .get("/api/v1/workouts/migration/reviews")
        .query({ ownerType: "workoutLog", ownerId: "1" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockReviews);
      expect(listBackfillReviews).toHaveBeenCalledWith(TEST_USER_ID, { ownerType: "workoutLog", ownerId: "1" });
    });

    it("lists backfill reviews with no query params", async () => {
      const mockReviews = [{ ownerId: "1", ownerType: "workoutLog", status: "needs_manual_review" }];
      vi.mocked(listBackfillReviews).mockResolvedValueOnce(mockReviews as any);

      const response = await request(app).get("/api/v1/workouts/migration/reviews");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockReviews);
      expect(listBackfillReviews).toHaveBeenCalledWith(TEST_USER_ID, {});
    });

    it("returns 400 when ownerType is provided without ownerId", async () => {
      const response = await request(app)
        .get("/api/v1/workouts/migration/reviews")
        .query({ ownerType: "workoutLog" });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("ownerType and ownerId must be provided together");
    });

    it("returns 400 when ownerId is provided without ownerType", async () => {
      const response = await request(app)
        .get("/api/v1/workouts/migration/reviews")
        .query({ ownerId: "1" });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("ownerType and ownerId must be provided together");
    });
  });

  describe("POST /api/v1/workouts/migration/reviews/resolve", () => {
    it("resolves a review successfully (action: accept -> resolved)", async () => {
      vi.mocked(resolveBackfillReview).mockResolvedValueOnce(true);

      const payload = {
        ownerType: "workoutLog",
        ownerId: "w1",
        action: "accept"
      };

      const response = await request(app)
        .post("/api/v1/workouts/migration/reviews/resolve")
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
      expect(resolveBackfillReview).toHaveBeenCalledWith("workoutLog", "w1", TEST_USER_ID, "resolved", null);
    });

    it("resolves a review successfully (action: edit -> resolved)", async () => {
      vi.mocked(resolveBackfillReview).mockResolvedValueOnce(true);

      const payload = {
        ownerType: "planDay",
        ownerId: "p1",
        action: "edit",
        reason: "Edited by user"
      };

      const response = await request(app)
        .post("/api/v1/workouts/migration/reviews/resolve")
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
      expect(resolveBackfillReview).toHaveBeenCalledWith("planDay", "p1", TEST_USER_ID, "resolved", "Edited by user");
    });

    it("resolves a review successfully (action: reject -> needs_manual_review)", async () => {
      vi.mocked(resolveBackfillReview).mockResolvedValueOnce(true);

      const payload = {
        ownerType: "workoutLog",
        ownerId: "w2",
        action: "reject",
        reason: "bad parse"
      };

      const response = await request(app)
        .post("/api/v1/workouts/migration/reviews/resolve")
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
      expect(resolveBackfillReview).toHaveBeenCalledWith("workoutLog", "w2", TEST_USER_ID, "needs_manual_review", "bad parse");
    });

    it("returns 404 when migration review target is not found", async () => {
      vi.mocked(resolveBackfillReview).mockResolvedValueOnce(false);

      const payload = {
        ownerType: "workoutLog",
        ownerId: "nonexistent",
        action: "accept"
      };

      const response = await request(app)
        .post("/api/v1/workouts/migration/reviews/resolve")
        .send(payload);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Migration review target not found", code: "NOT_FOUND" });
    });

    it("returns 400 for invalid payload (missing ownerType)", async () => {
      const payload = {
        ownerId: "w1",
        action: "accept"
      };

      const response = await request(app)
        .post("/api/v1/workouts/migration/reviews/resolve")
        .send(payload);

      expect(response.status).toBe(400);
    });

    it("returns 400 for invalid payload (invalid action)", async () => {
      const payload = {
        ownerType: "workoutLog",
        ownerId: "w1",
        action: "invalid_action"
      };

      const response = await request(app)
        .post("/api/v1/workouts/migration/reviews/resolve")
        .send(payload);

      expect(response.status).toBe(400);
    });
  });
});
