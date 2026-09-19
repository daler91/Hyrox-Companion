import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../routeUtils";
import { storage } from "../../storage";
import recycleBinRouter from "../recycleBin";
import { createTestApp } from "./testUtils";

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());

vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());

vi.mock("../../storage", async () =>
  (await import("./testUtils")).mockStorageModule({
    recycleBin: ["list", "get", "restore", "restoreBatch", "purgeItem", "emptyBin"],
    plans: ["findOverlappingActivePlans"],
  }),
);

const USER = "test_user_id";

function workoutItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "rb-1",
    userId: USER,
    entityType: "workout_log",
    entityId: "w1",
    batchId: null,
    label: "Strength",
    summary: "5x5 Back Squat",
    entityDate: "2026-09-01",
    childCount: 5,
    stravaActivityId: null,
    garminActivityId: null,
    payload: {
      version: 1,
      kind: "workout_log",
      workout: {
        log: { id: "w1" },
        exerciseSets: [],
        structureBlocks: [],
        mafWorkoutAnalysisIds: [],
      },
    },
    deletedAt: new Date("2026-09-18T10:00:00.000Z"),
    expiresAt: new Date("2026-12-17T10:00:00.000Z"),
    ...overrides,
  };
}

function planItem(plan: Record<string, unknown>) {
  return workoutItem({
    id: "rb-plan",
    entityType: "training_plan",
    entityId: "p1",
    label: "Build",
    payload: {
      version: 1,
      kind: "training_plan",
      plan: { id: "p1", retiredOn: null, startDate: "2026-06-01", endDate: "2026-08-24", ...plan },
      days: [],
      linkedWorkoutLogs: [],
    },
  });
}

describe("Recycle Bin Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(recycleBinRouter);
  });

  describe("GET /api/v1/recycle-bin", () => {
    it("returns the user's listing", async () => {
      const listing = {
        items: [{ id: "rb-1", entityType: "workout_log", label: "Strength" }],
        counts: { total: 1, workout_log: 1, plan_day: 0, training_plan: 0 },
      };
      vi.mocked(storage.recycleBin.list).mockResolvedValue(listing as never);

      const response = await request(app).get("/api/v1/recycle-bin");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(listing);
      expect(storage.recycleBin.list).toHaveBeenCalledWith(USER);
    });
  });

  describe("POST /api/v1/recycle-bin/:id/restore", () => {
    it("restores an item and returns the outcome", async () => {
      vi.mocked(storage.recycleBin.get).mockResolvedValue(workoutItem() as never);
      const outcome = {
        ok: true,
        entityType: "workout_log",
        entityId: "w1",
        batchId: null,
        warnings: ["restored unplanned"],
      };
      vi.mocked(storage.recycleBin.restore).mockResolvedValue(outcome as never);

      const response = await request(app).post("/api/v1/recycle-bin/rb-1/restore");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(outcome);
      expect(storage.recycleBin.restore).toHaveBeenCalledWith(USER, "rb-1");
      expect(storage.plans.findOverlappingActivePlans).not.toHaveBeenCalled();
    });

    it("404s for an unknown, expired or foreign item without attempting a restore", async () => {
      vi.mocked(storage.recycleBin.get).mockResolvedValue(undefined);

      const response = await request(app).post("/api/v1/recycle-bin/rb-404/restore");

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Recycle bin item not found", code: "NOT_FOUND" });
      expect(storage.recycleBin.restore).not.toHaveBeenCalled();
    });

    it("refuses to restore a live plan over another live plan's dates, with the retirement route's copy", async () => {
      vi.mocked(storage.recycleBin.get).mockResolvedValue(planItem({}) as never);
      vi.mocked(storage.plans.findOverlappingActivePlans).mockResolvedValue([
        { id: "p2", name: "Race block" },
      ] as never);

      const response = await request(app).post("/api/v1/recycle-bin/rb-plan/restore");

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: '"Race block" already covers these dates. Archive it first to restore this plan.',
        code: "PLAN_OVERLAP",
      });
      expect(storage.plans.findOverlappingActivePlans).toHaveBeenCalledWith(
        USER,
        "2026-06-01",
        "2026-08-24",
      );
      expect(storage.recycleBin.restore).not.toHaveBeenCalled();
    });

    it("skips the overlap check for a plan that was archived when it was deleted", async () => {
      vi.mocked(storage.recycleBin.get).mockResolvedValue(
        planItem({ retiredOn: "2026-07-01" }) as never,
      );
      vi.mocked(storage.recycleBin.restore).mockResolvedValue({
        ok: true,
        entityType: "training_plan",
        entityId: "p1",
        batchId: null,
        warnings: [],
      });

      const response = await request(app).post("/api/v1/recycle-bin/rb-plan/restore");

      expect(response.status).toBe(200);
      expect(storage.plans.findOverlappingActivePlans).not.toHaveBeenCalled();
    });

    it("maps a storage conflict to 409 RECYCLE_BIN_CONFLICT", async () => {
      vi.mocked(storage.recycleBin.get).mockResolvedValue(workoutItem() as never);
      vi.mocked(storage.recycleBin.restore).mockResolvedValue({
        ok: false,
        reason: "device_activity_reimported",
        message: "imported again",
      });

      const response = await request(app).post("/api/v1/recycle-bin/rb-1/restore");

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: "imported again", code: "RECYCLE_BIN_CONFLICT" });
    });

    it("maps a storage not_found (e.g. parent plan gone) to 404 with the storage message", async () => {
      vi.mocked(storage.recycleBin.get).mockResolvedValue(workoutItem() as never);
      vi.mocked(storage.recycleBin.restore).mockResolvedValue({
        ok: false,
        reason: "not_found",
        message: "Restore the plan first.",
      });

      const response = await request(app).post("/api/v1/recycle-bin/rb-1/restore");

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Restore the plan first.", code: "NOT_FOUND" });
    });
  });

  describe("POST /api/v1/recycle-bin/batches/:batchId/restore", () => {
    it("restores the batch", async () => {
      const outcome = {
        ok: true,
        batchId: "batch-1",
        restored: [{ entityType: "workout_log", entityId: "w1" }],
        warnings: [],
      };
      vi.mocked(storage.recycleBin.restoreBatch).mockResolvedValue(outcome as never);

      const response = await request(app).post("/api/v1/recycle-bin/batches/batch-1/restore");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(outcome);
      expect(storage.recycleBin.restoreBatch).toHaveBeenCalledWith(USER, "batch-1");
    });

    it("404s when the batch has nothing restorable", async () => {
      vi.mocked(storage.recycleBin.restoreBatch).mockResolvedValue({
        ok: false,
        reason: "not_found",
        message: "Recycle bin item not found",
      });

      const response = await request(app).post("/api/v1/recycle-bin/batches/batch-404/restore");

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE routes", () => {
    it("purges one item", async () => {
      vi.mocked(storage.recycleBin.purgeItem).mockResolvedValue(true);

      const response = await request(app).delete("/api/v1/recycle-bin/rb-1");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(storage.recycleBin.purgeItem).toHaveBeenCalledWith(USER, "rb-1");
    });

    it("404s when the item is not the user's", async () => {
      vi.mocked(storage.recycleBin.purgeItem).mockResolvedValue(false);

      const response = await request(app).delete("/api/v1/recycle-bin/rb-1");

      expect(response.status).toBe(404);
    });

    it("empties the bin and reports the count", async () => {
      vi.mocked(storage.recycleBin.emptyBin).mockResolvedValue(4);

      const response = await request(app).delete("/api/v1/recycle-bin");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, purgedCount: 4 });
      expect(storage.recycleBin.emptyBin).toHaveBeenCalledWith(USER);
    });
  });
});
