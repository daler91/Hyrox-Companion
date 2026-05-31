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

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    const router = express.Router();
    registerWorkoutTimelineRoutes(router);
    app = createTestApp(router);
  });

  it("should return timeline with default limit and no offset", async () => {
    const mockEntries = [{ id: "entry-1", type: "workout", date: "2024-01-01" }];
    vi.mocked(storage.timeline.getTimeline).mockResolvedValue(mockEntries);

    const res = await request(app).get("/api/v1/timeline");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockEntries);
    expect(storage.timeline.getTimeline).toHaveBeenCalledWith(
      "test_user_id",
      undefined,
      DEFAULT_TIMELINE_LIMIT,
      undefined
    );
  });

  it("should pass limit and offset to storage when valid query params are provided", async () => {
    const mockEntries = [{ id: "entry-2", type: "workout", date: "2024-01-02" }];
    vi.mocked(storage.timeline.getTimeline).mockResolvedValue(mockEntries);

    const res = await request(app).get("/api/v1/timeline?limit=10&offset=5");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockEntries);
    expect(storage.timeline.getTimeline).toHaveBeenCalledWith(
      "test_user_id",
      undefined,
      10,
      5
    );
  });

  it("should pass planId to storage when provided in query params", async () => {
    const mockEntries = [{ id: "entry-3", type: "workout", date: "2024-01-03" }];
    vi.mocked(storage.timeline.getTimeline).mockResolvedValue(mockEntries);

    const res = await request(app).get("/api/v1/timeline?planId=test_plan_id");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockEntries);
    expect(storage.timeline.getTimeline).toHaveBeenCalledWith(
      "test_user_id",
      "test_plan_id",
      DEFAULT_TIMELINE_LIMIT,
      undefined
    );
  });

  it("should cap the requested limit at DEFAULT_TIMELINE_LIMIT", async () => {
    const mockEntries = [{ id: "entry-4", type: "workout", date: "2024-01-04" }];
    vi.mocked(storage.timeline.getTimeline).mockResolvedValue(mockEntries);

    const excessiveLimit = DEFAULT_TIMELINE_LIMIT + 100;
    const res = await request(app).get(`/api/v1/timeline?limit=${excessiveLimit}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockEntries);
    expect(storage.timeline.getTimeline).toHaveBeenCalledWith(
      "test_user_id",
      undefined,
      DEFAULT_TIMELINE_LIMIT,
      undefined
    );
  });

  it("should return 400 when invalid limit is provided", async () => {
    const res = await request(app).get("/api/v1/timeline?limit=-5");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid limit", code: "BAD_REQUEST" });
    expect(storage.timeline.getTimeline).not.toHaveBeenCalled();
  });

  it("should return 400 when invalid offset is provided", async () => {
    const res = await request(app).get("/api/v1/timeline?offset=-5");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid offset", code: "BAD_REQUEST" });
    expect(storage.timeline.getTimeline).not.toHaveBeenCalled();
  });

  it("should handle storage returning empty array correctly", async () => {
    vi.mocked(storage.timeline.getTimeline).mockResolvedValue([]);

    const res = await request(app).get("/api/v1/timeline");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("should pass error properly if storage throws an error", async () => {
    vi.mocked(storage.timeline.getTimeline).mockRejectedValue(new Error("Database connection failed"));

    const res = await request(app).get("/api/v1/timeline");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" });
  });
});
