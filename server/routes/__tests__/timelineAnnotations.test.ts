import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../routeUtils";
import { storage } from "../../storage";
import timelineAnnotationsRouter from "../timelineAnnotations";
import { createTestApp } from "./testUtils";

// Mock auth middleware
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { userId: "test_user_id" };
    next();
  },
}));

vi.mock("../../types", () => ({
  getUserId: () => "test_user_id",
}));

// Mock the storage layer so we can drive tests without a DB connection
vi.mock("../../storage", () => ({
  storage: {
    timelineAnnotations: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    idempotency: {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

describe("Timeline Annotations Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(timelineAnnotationsRouter);
  });

  describe("GET /api/v1/timeline-annotations", () => {
    it("returns the authenticated user's annotations", async () => {
      const mockAnnotations = [
        {
          id: "a1",
          userId: "test_user_id",
          startDate: "2026-03-01",
          endDate: "2026-03-07",
          type: "injury",
          note: "Calf strain",
          createdAt: new Date("2026-03-01T00:00:00Z"),
          updatedAt: new Date("2026-03-01T00:00:00Z"),
        },
      ];
      vi.mocked(storage.timelineAnnotations.list).mockResolvedValue(mockAnnotations as never);

      const response = await request(app).get("/api/v1/timeline-annotations");

      expect(response.status).toBe(200);
      expect(storage.timelineAnnotations.list).toHaveBeenCalledWith("test_user_id");
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({ id: "a1", type: "injury", note: "Calf strain" });
    });
  });

  describe("POST /api/v1/timeline-annotations", () => {
    it("creates a valid annotation", async () => {
      vi.mocked(storage.timelineAnnotations.create).mockResolvedValue({
        id: "a2",
        userId: "test_user_id",
        startDate: "2026-04-01",
        endDate: "2026-04-03",
        type: "travel",
        note: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const response = await request(app)
        .post("/api/v1/timeline-annotations")
        .send({ startDate: "2026-04-01", endDate: "2026-04-03", type: "travel" });

      expect(response.status).toBe(201);
      expect(storage.timelineAnnotations.create).toHaveBeenCalledWith("test_user_id", {
        startDate: "2026-04-01",
        endDate: "2026-04-03",
        type: "travel",
      });
    });

    it("rejects a payload with missing fields", async () => {
      const response = await request(app)
        .post("/api/v1/timeline-annotations")
        .send({ startDate: "2026-04-01" });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(storage.timelineAnnotations.create).not.toHaveBeenCalled();
    });

    it("rejects an unknown annotation type", async () => {
      const response = await request(app)
        .post("/api/v1/timeline-annotations")
        .send({ startDate: "2026-04-01", endDate: "2026-04-03", type: "vacation" });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });

    it("rejects endDate before startDate", async () => {
      const response = await request(app)
        .post("/api/v1/timeline-annotations")
        .send({ startDate: "2026-04-10", endDate: "2026-04-01", type: "injury" });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });

    it("accepts a note up to 500 characters", async () => {
      vi.mocked(storage.timelineAnnotations.create).mockResolvedValue({
        id: "a3",
        userId: "test_user_id",
        startDate: "2026-04-01",
        endDate: "2026-04-03",
        type: "illness",
        note: "x".repeat(500),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const response = await request(app)
        .post("/api/v1/timeline-annotations")
        .send({
          startDate: "2026-04-01",
          endDate: "2026-04-03",
          type: "illness",
          note: "x".repeat(500),
        });

      expect(response.status).toBe(201);
    });

    it("rejects a note longer than 500 characters", async () => {
      const response = await request(app)
        .post("/api/v1/timeline-annotations")
        .send({
          startDate: "2026-04-01",
          endDate: "2026-04-03",
          type: "illness",
          note: "x".repeat(501),
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("PATCH /api/v1/timeline-annotations/:id", () => {
    it("updates an existing annotation", async () => {
      vi.mocked(storage.timelineAnnotations.update).mockResolvedValue({
        id: "a1",
        userId: "test_user_id",
        startDate: "2026-03-01",
        endDate: "2026-03-14",
        type: "injury",
        note: "Extended recovery",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const response = await request(app)
        .patch("/api/v1/timeline-annotations/a1")
        .send({ endDate: "2026-03-14", note: "Extended recovery" });

      expect(response.status).toBe(200);
      expect(storage.timelineAnnotations.update).toHaveBeenCalledWith("test_user_id", "a1", {
        endDate: "2026-03-14",
        note: "Extended recovery",
      });
    });

    it("returns 404 when the annotation doesn't exist or belongs to another user", async () => {
      vi.mocked(storage.timelineAnnotations.update).mockResolvedValue(undefined);

      const response = await request(app)
        .patch("/api/v1/timeline-annotations/nonexistent")
        .send({ note: "Test" });

      expect(response.status).toBe(404);
    });

    it("rejects an update where endDate is before startDate", async () => {
      const response = await request(app)
        .patch("/api/v1/timeline-annotations/a1")
        .send({ startDate: "2026-04-10", endDate: "2026-04-01" });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(storage.timelineAnnotations.update).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/v1/timeline-annotations/:id", () => {
    it("deletes an existing annotation", async () => {
      vi.mocked(storage.timelineAnnotations.delete).mockResolvedValue(true);

      const response = await request(app).delete("/api/v1/timeline-annotations/a1");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(storage.timelineAnnotations.delete).toHaveBeenCalledWith("test_user_id", "a1");
    });

    it("returns 404 when the annotation doesn't exist", async () => {
      vi.mocked(storage.timelineAnnotations.delete).mockResolvedValue(false);

      const response = await request(app).delete("/api/v1/timeline-annotations/missing");

      expect(response.status).toBe(404);
    });
  });
});
