import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TIMELINE_LIMIT, DEFAULT_TIMELINE_PAGE_SIZE } from "../../constants";
import { clearRateLimitBuckets } from "../../routeUtils";
import { storage } from "../../storage";
import workoutsRouter from "../workouts";
import { createTestApp, resetRouteTestState } from "./testUtils";

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());
vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());
vi.mock("../../storage", async () =>
  (await import("./testUtils")).mockStorageModule({
    timeline: ["getTimeline", "getTimelinePage"],
  }),
);

describe("Workout Timeline Routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetRouteTestState();
    clearRateLimitBuckets();
    app = createTestApp(workoutsRouter);
  });

  describe("GET /api/v1/timeline", () => {
    it("returns the user's first timeline page with the default page size", async () => {
      const mockEntries = [
        {
          id: "entry-1",
          type: "workout",
          date: "2026-05-01",
          planId: "plan-1",
        },
      ];
      vi.mocked(storage.timeline.getTimelinePage).mockResolvedValue({ entries: mockEntries, nextCursor: null } as never);

      const response = await request(app).get("/api/v1/timeline");

      expect(response.status).toBe(200);
      expect(storage.timeline.getTimelinePage).toHaveBeenCalledWith("test_user_id", {
        planId: undefined,
        limit: DEFAULT_TIMELINE_PAGE_SIZE,
        before: undefined,
      });
      expect(response.body).toEqual(mockEntries);
      expect(response.headers["x-next-cursor"]).toBeUndefined();
    });

    it("accepts planId and before parameters and surfaces the next cursor", async () => {
      vi.mocked(storage.timeline.getTimelinePage).mockResolvedValue({ entries: [], nextCursor: "2026-01-01" });

      const response = await request(app).get("/api/v1/timeline?planId=plan-123&before=2026-02-01");

      expect(response.status).toBe(200);
      expect(storage.timeline.getTimelinePage).toHaveBeenCalledWith("test_user_id", {
        planId: "plan-123",
        limit: DEFAULT_TIMELINE_PAGE_SIZE,
        before: "2026-02-01",
      });
      expect(response.headers["x-next-cursor"]).toBe("2026-01-01");
    });

    it("keeps the legacy limit/offset window on the flat merge", async () => {
      vi.mocked(storage.timeline.getTimeline).mockResolvedValue([] as never);

      const response = await request(app).get("/api/v1/timeline?limit=10&offset=20");

      expect(response.status).toBe(200);
      expect(storage.timeline.getTimeline).toHaveBeenCalledWith("test_user_id", undefined, 10, 20);
      expect(storage.timeline.getTimelinePage).not.toHaveBeenCalled();
    });

    it("clamps limit to DEFAULT_TIMELINE_LIMIT", async () => {
      vi.mocked(storage.timeline.getTimelinePage).mockResolvedValue({ entries: [], nextCursor: null });

      const requestedLimit = DEFAULT_TIMELINE_LIMIT + 100;
      const response = await request(app).get(`/api/v1/timeline?limit=${requestedLimit}`);

      expect(response.status).toBe(200);
      expect(storage.timeline.getTimelinePage).toHaveBeenCalledWith("test_user_id", {
        planId: undefined,
        limit: DEFAULT_TIMELINE_LIMIT,
        before: undefined,
      });
    });

    it.each([
      ["limit", "?limit=invalid"],
      ["offset", "?offset=invalid"],
      ["before", "?before=not-a-date"],
    ])("rejects an invalid %s parameter", async (_name, query) => {
      const response = await request(app).get(`/api/v1/timeline${query}`);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("BAD_REQUEST");
      expect(storage.timeline.getTimeline).not.toHaveBeenCalled();
      expect(storage.timeline.getTimelinePage).not.toHaveBeenCalled();
    });
  });
});
