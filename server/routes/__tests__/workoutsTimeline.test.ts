import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TIMELINE_LIMIT } from "../../constants";
import { clearRateLimitBuckets } from "../../routeUtils";
import { storage } from "../../storage";
import workoutsRouter from "../workouts";
import { createTestApp, resetRouteTestState } from "./testUtils";

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

describe("Workout Timeline Routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetRouteTestState();
    clearRateLimitBuckets();
    app = createTestApp(workoutsRouter);
  });

  describe("GET /api/v1/timeline", () => {
    it("returns the user's timeline entries with default limit", async () => {
      const mockEntries = [
        {
          id: "entry-1",
          type: "workout",
          date: "2026-05-01",
          planId: "plan-1",
        },
      ];
      vi.mocked(storage.timeline.getTimeline).mockResolvedValue(mockEntries as never);

      const response = await request(app).get("/api/v1/timeline");

      expect(response.status).toBe(200);
      expect(storage.timeline.getTimeline).toHaveBeenCalledWith("test_user_id", undefined, DEFAULT_TIMELINE_LIMIT, undefined);
      expect(response.body).toEqual(mockEntries);
    });

    it("accepts planId parameter", async () => {
      vi.mocked(storage.timeline.getTimeline).mockResolvedValue([] as never);

      const response = await request(app).get("/api/v1/timeline?planId=plan-123");

      expect(response.status).toBe(200);
      expect(storage.timeline.getTimeline).toHaveBeenCalledWith("test_user_id", "plan-123", DEFAULT_TIMELINE_LIMIT, undefined);
    });

    it("parses valid limit and offset parameters", async () => {
      vi.mocked(storage.timeline.getTimeline).mockResolvedValue([] as never);

      const response = await request(app).get("/api/v1/timeline?limit=10&offset=20");

      expect(response.status).toBe(200);
      expect(storage.timeline.getTimeline).toHaveBeenCalledWith("test_user_id", undefined, 10, 20);
    });

    it("clamps limit to DEFAULT_TIMELINE_LIMIT", async () => {
      vi.mocked(storage.timeline.getTimeline).mockResolvedValue([] as never);

      const requestedLimit = DEFAULT_TIMELINE_LIMIT + 100;
      const response = await request(app).get(`/api/v1/timeline?limit=${requestedLimit}`);

      expect(response.status).toBe(200);
      expect(storage.timeline.getTimeline).toHaveBeenCalledWith("test_user_id", undefined, DEFAULT_TIMELINE_LIMIT, undefined);
    });

    it("rejects invalid limit parameter", async () => {
      const response = await request(app).get("/api/v1/timeline?limit=invalid");

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("BAD_REQUEST");
      expect(storage.timeline.getTimeline).not.toHaveBeenCalled();
    });

    it("rejects invalid offset parameter", async () => {
      const response = await request(app).get("/api/v1/timeline?offset=invalid");

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("BAD_REQUEST");
      expect(storage.timeline.getTimeline).not.toHaveBeenCalled();
    });
  });
});
