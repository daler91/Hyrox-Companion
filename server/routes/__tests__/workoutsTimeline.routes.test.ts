import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TIMELINE_LIMIT } from "../../constants";
import { clearRateLimitBuckets } from "../../routeUtils";
import { storage } from "../../storage";
import { registerWorkoutTimelineRoutes } from "../workouts/workoutsTimeline.routes";
import { createTestApp } from "./testUtils";

vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { userId: "test_user_id" };
    next();
  },
}));

vi.mock("../../types", () => ({
  getUserId: () => "test_user_id",
}));

vi.mock("../../storage", () => ({
  storage: {
    timeline: {
      getTimeline: vi.fn(),
    },
  },
}));

describe("GET /api/v1/timeline", () => {
  let app: ReturnType<typeof createTestApp>;
  const mockEntries = [{ id: "entry-1", type: "workout", date: "2024-01-01" }];

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    const router = express.Router();
    registerWorkoutTimelineRoutes(router);
    app = createTestApp(router);
  });

  describe("Success cases", () => {
    beforeEach(() => {
      vi.mocked(storage.timeline.getTimeline).mockResolvedValue(mockEntries);
    });

    it.each([
      {
        name: "default limit and no offset",
        query: "",
        expectedArgs: ["test_user_id", undefined, DEFAULT_TIMELINE_LIMIT, undefined],
      },
      {
        name: "explicit valid limit and offset",
        query: "?limit=10&offset=5",
        expectedArgs: ["test_user_id", undefined, 10, 5],
      },
      {
        name: "explicit planId",
        query: "?planId=test_plan_id",
        expectedArgs: ["test_user_id", "test_plan_id", DEFAULT_TIMELINE_LIMIT, undefined],
      },
      {
        name: "capped limit when exceeding max",
        query: `?limit=${DEFAULT_TIMELINE_LIMIT + 100}`,
        expectedArgs: ["test_user_id", undefined, DEFAULT_TIMELINE_LIMIT, undefined],
      },
    ])("should return 200 and entries for $name", async ({ query, expectedArgs }) => {
      const res = await request(app).get(`/api/v1/timeline${query}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockEntries);
      expect(storage.timeline.getTimeline).toHaveBeenCalledWith(...expectedArgs);
    });

    it("should handle storage returning empty array correctly", async () => {
      vi.mocked(storage.timeline.getTimeline).mockResolvedValue([]);
      const res = await request(app).get("/api/v1/timeline");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("Error cases", () => {
    it.each([
      { name: "invalid limit", query: "?limit=-5", expectedError: "Invalid limit" },
      { name: "invalid offset", query: "?offset=-5", expectedError: "Invalid offset" },
    ])("should return 400 for $name", async ({ query, expectedError }) => {
      const res = await request(app).get(`/api/v1/timeline${query}`);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: expectedError, code: "BAD_REQUEST" });
      expect(storage.timeline.getTimeline).not.toHaveBeenCalled();
    });

    it("should pass error properly if storage throws an error", async () => {
      vi.mocked(storage.timeline.getTimeline).mockRejectedValue(new Error("Database connection failed"));

      const res = await request(app).get("/api/v1/timeline");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" });
    });
  });
});
