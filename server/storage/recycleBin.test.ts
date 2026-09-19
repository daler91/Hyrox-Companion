import { workoutLogs } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  db: { select: vi.fn(), delete: vi.fn(), transaction: vi.fn() },
}));
vi.mock("./planDayStatus", () => ({
  syncPlanDayStatusFromWorkouts: vi.fn(),
  syncPlanDayStatusesFromWorkouts: vi.fn(),
}));

import { db } from "../db";
import { RecycleBinStorage, reviveRow } from "./recycleBin";

describe("reviveRow", () => {
  it("turns the ISO strings jsonb hands back into Dates for timestamp columns only", () => {
    const revived = reviveRow(workoutLogs, {
      id: "w1",
      date: "2026-09-01",
      startedAt: "2026-09-01T06:30:00.000Z",
      notes: "2026-09-01T06:30:00.000Z",
      someColumnDroppedSince: "kept for drizzle to ignore",
    });
    expect(revived.startedAt).toBeInstanceOf(Date);
    expect((revived.startedAt as Date).toISOString()).toBe("2026-09-01T06:30:00.000Z");
    expect(revived.date).toBe("2026-09-01"); // date columns stay strings
    expect(revived.notes).toBe("2026-09-01T06:30:00.000Z"); // text is never touched
  });

  it("leaves a null timestamp alone", () => {
    expect(reviveRow(workoutLogs, { id: "w1", startedAt: null }).startedAt).toBeNull();
  });
});

describe("RecycleBinStorage", () => {
  const storage = new RecycleBinStorage();
  const now = new Date("2026-09-19T00:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("maps rows to listing items and counts per type from the separate grouped query", async () => {
      const row = {
        id: "rb-1",
        userId: "u1",
        entityType: "workout_log",
        entityId: "w1",
        batchId: null,
        label: "Strength",
        summary: "5x5",
        entityDate: "2026-09-01",
        childCount: 2,
        stravaActivityId: null,
        garminActivityId: null,
        deletedAt: new Date("2026-09-18T10:00:00.000Z"),
        expiresAt: new Date("2026-12-17T10:00:00.000Z"),
      };
      const limitMock = vi.fn().mockResolvedValue([row]);
      const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
      const groupByMock = vi.fn().mockResolvedValue([
        { entityType: "workout_log", count: 7 },
        { entityType: "plan_day", count: 1 },
        { entityType: "bogus", count: 99 },
      ]);
      const whereMock = vi
        .fn()
        .mockReturnValueOnce({ orderBy: orderByMock })
        .mockReturnValueOnce({ groupBy: groupByMock });
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock } as never); // NOSONAR partial Drizzle query-builder mock

      const result = await storage.list("u1", now);

      expect(result.items).toEqual([
        {
          id: "rb-1",
          entityType: "workout_log",
          entityId: "w1",
          batchId: null,
          label: "Strength",
          summary: "5x5",
          entityDate: "2026-09-01",
          childCount: 2,
          deletedAt: "2026-09-18T10:00:00.000Z",
          expiresAt: "2026-12-17T10:00:00.000Z",
        },
      ]);
      expect(result.counts).toEqual({ total: 8, workout_log: 7, plan_day: 1, training_plan: 0 });
      expect(limitMock).toHaveBeenCalledWith(500);
    });
  });

  describe("restore", () => {
    function mockTransactionWithItems(items: unknown[]) {
      const forMock = vi.fn().mockResolvedValue(items);
      const whereMock = vi.fn().mockReturnValue({ for: forMock });
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      const tx = { select: vi.fn().mockReturnValue({ from: fromMock }), delete: vi.fn() };
      vi.mocked(db.transaction).mockImplementation(async (callback) => callback(tx as never));
      return tx;
    }

    it("reports not_found (without deleting anything) when the item is missing, expired, or another user's", async () => {
      const tx = mockTransactionWithItems([]);
      expect(await storage.restore("u1", "rb-404", now)).toEqual({
        ok: false,
        reason: "not_found",
        message: "Recycle bin item not found",
      });
      expect(tx.delete).not.toHaveBeenCalled();
    });

    it("maps a unique violation raised inside the transaction to id_conflict", async () => {
      vi.mocked(db.transaction).mockRejectedValue(
        Object.assign(new Error("dup"), { cause: { code: "23505" } }),
      );
      const result = await storage.restore("u1", "rb-1", now);
      expect(result).toMatchObject({ ok: false, reason: "id_conflict" });
    });

    it("rethrows any other database error", async () => {
      vi.mocked(db.transaction).mockRejectedValue(new Error("connection lost"));
      await expect(storage.restore("u1", "rb-1", now)).rejects.toThrow("connection lost");
    });

    it("restoreBatch reports not_found for an unknown batch", async () => {
      mockTransactionWithItems([]);
      expect(await storage.restoreBatch("u1", "batch-404", now)).toEqual({
        ok: false,
        reason: "not_found",
        message: "Recycle bin item not found",
      });
    });
  });

  describe("purges", () => {
    function mockDelete(returned: unknown[]) {
      const returningMock = vi.fn().mockResolvedValue(returned);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      vi.mocked(db.delete).mockReturnValue({ where: whereMock } as never); // NOSONAR partial Drizzle query-builder mock
      return { whereMock };
    }

    it("purgeItem returns whether a row was deleted", async () => {
      mockDelete([{ id: "rb-1" }]);
      expect(await storage.purgeItem("u1", "rb-1")).toBe(true);
      mockDelete([]);
      expect(await storage.purgeItem("u1", "rb-1")).toBe(false);
    });

    it("emptyBin and purgeExpired return the number of rows removed", async () => {
      mockDelete([{ id: "a" }, { id: "b" }, { id: "c" }]);
      expect(await storage.emptyBin("u1")).toBe(3);
      mockDelete([{ id: "a" }]);
      expect(await storage.purgeExpired(now)).toBe(1);
    });
  });
});
