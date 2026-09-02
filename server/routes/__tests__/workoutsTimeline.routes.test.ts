import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TIMELINE_LIMIT, DEFAULT_TIMELINE_PAGE_SIZE } from "../../constants";
import { clearRateLimitBuckets } from "../../routeUtils";
import { storage } from "../../storage";
import { registerWorkoutTimelineRoutes } from "../workouts/workoutsTimeline.routes";
import { createTestApp } from "./testUtils";

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());

vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());

vi.mock("../../storage", async () =>
  (await import("./testUtils")).mockStorageModule({
    timeline: ["getTimeline", "getTimelinePage"],
  }),
);

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

  describe("cursor pages (P3)", () => {
    beforeEach(() => {
      vi.mocked(storage.timeline.getTimelinePage).mockResolvedValue({ entries: mockEntries, nextCursor: null } as never);
    });

    it.each([
      {
        name: "default page size and no cursor",
        query: "",
        expectedOptions: { planId: undefined, limit: DEFAULT_TIMELINE_PAGE_SIZE, before: undefined },
      },
      {
        name: "explicit planId",
        query: "?planId=test_plan_id",
        expectedOptions: { planId: "test_plan_id", limit: DEFAULT_TIMELINE_PAGE_SIZE, before: undefined },
      },
      {
        name: "an older page requested with before",
        query: "?before=2026-01-15&limit=50",
        expectedOptions: { planId: undefined, limit: 50, before: "2026-01-15" },
      },
      {
        name: "capped limit when exceeding max",
        query: `?limit=${DEFAULT_TIMELINE_LIMIT + 100}`,
        expectedOptions: { planId: undefined, limit: DEFAULT_TIMELINE_LIMIT, before: undefined },
      },
    ])("should return 200 and the page entries for $name", async ({ query, expectedOptions }) => {
      const res = await request(app).get(`/api/v1/timeline${query}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockEntries);
      expect(res.headers["x-next-cursor"]).toBeUndefined();
      expect(storage.timeline.getTimelinePage).toHaveBeenCalledWith("test_user_id", expectedOptions);
      expect(storage.timeline.getTimeline).not.toHaveBeenCalled();
    });

    it("surfaces the next cursor as a header and keeps the body a plain array", async () => {
      vi.mocked(storage.timeline.getTimelinePage).mockResolvedValue({ entries: mockEntries, nextCursor: "2025-12-01" } as never);

      const res = await request(app).get("/api/v1/timeline");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockEntries);
      expect(res.headers["x-next-cursor"]).toBe("2025-12-01");
    });

    it("should handle storage returning an empty page correctly", async () => {
      vi.mocked(storage.timeline.getTimelinePage).mockResolvedValue({ entries: [], nextCursor: null });
      const res = await request(app).get("/api/v1/timeline");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("legacy offset window", () => {
    it("windows the flat merge with limit/offset and no cursor header", async () => {
      vi.mocked(storage.timeline.getTimeline).mockResolvedValue(mockEntries as never);

      const res = await request(app).get("/api/v1/timeline?limit=10&offset=5");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockEntries);
      expect(res.headers["x-next-cursor"]).toBeUndefined();
      expect(storage.timeline.getTimeline).toHaveBeenCalledWith("test_user_id", undefined, 10, 5);
      expect(storage.timeline.getTimelinePage).not.toHaveBeenCalled();
    });
  });

  describe("Error cases", () => {
    it.each([
      { name: "invalid limit", query: "?limit=-5", expectedError: "Invalid limit" },
      { name: "invalid offset", query: "?offset=-5", expectedError: "Invalid offset" },
      { name: "invalid before", query: "?before=yesterday", expectedError: "Invalid before" },
      { name: "a datetime before (dates only)", query: "?before=2026-01-15T00:00:00Z", expectedError: "Invalid before" },
    ])("should return 400 for $name", async ({ query, expectedError }) => {
      const res = await request(app).get(`/api/v1/timeline${query}`);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: expectedError, code: "BAD_REQUEST" });
      expect(storage.timeline.getTimeline).not.toHaveBeenCalled();
      expect(storage.timeline.getTimelinePage).not.toHaveBeenCalled();
    });

    it("should pass error properly if storage throws an error", async () => {
      vi.mocked(storage.timeline.getTimelinePage).mockRejectedValue(new Error("Database connection failed"));

      const res = await request(app).get("/api/v1/timeline");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" });
    });
  });
});
