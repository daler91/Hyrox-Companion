import { beforeEach,describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { PlanStorage } from "../plans";

vi.mock("../../db", () => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
    transaction: vi.fn(),
    query: {
      planDays: { findFirst: vi.fn() },
    },
  },
}));

vi.mock("../../storage", () => ({ storage: {} }));

// -- Helpers ------------------------------------------------------------------

function mockSelectChain(result: unknown[]) {
  const whereMock = vi.fn().mockResolvedValue(result);
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  vi.mocked(db.select).mockReturnValue({ from: fromMock });
  return { fromMock, whereMock };
}

// Mock the relational query `db.query.planDays.findFirst` used by
// PlanStorage.getPlanDay. Pass `undefined` (or omit) to simulate "not found",
// or a planDay row (with nested `plan.userId`) to simulate a hit.
function mockFindPlanDayFirst(result: { id: string; plan?: { userId: string } } | undefined) {
  vi.mocked(db.query.planDays.findFirst).mockResolvedValue(result);
}

function mockInsertChain(result: unknown[]) {
  const returningMock = vi.fn().mockResolvedValue(result);
  const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
  vi.mocked(db.insert).mockReturnValue({ values: valuesMock });
}

function mockUpdateChain(result: unknown[]) {
  const returningMock = vi.fn().mockResolvedValue(result);
  const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
  const setMock = vi.fn().mockReturnValue({ where: whereMock });
  vi.mocked(db.update).mockReturnValue({ set: setMock });
}

// Mock the two selects that getTrainingPlan issues (plan row, then its days).
function mockPlanWithDays(plan: { id: string; userId: string }, days: unknown[]) {
  vi.mocked(db.select)
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([plan]) }) })
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(days) }) });
}

// A recording transaction that captures update().set() payloads and insert().values()
// so tests can assert what applyRaceDayAdjustments wrote, without a real DB.
function makeRecordingTx() {
  const setPayloads: Record<string, unknown>[] = [];
  const insertValues: Record<string, unknown>[] = [];
  const tx = {
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        setPayloads.push(payload);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    insert: vi.fn(() => ({
      values: vi.fn((payload: Record<string, unknown>) => {
        insertValues.push(payload);
        return Promise.resolve(undefined);
      }),
    })),
  };
  return { tx, setPayloads, insertValues };
}

// -- Tests --------------------------------------------------------------------

describe("PlanStorage", () => {
  let storage: PlanStorage;

  beforeEach(() => {
    storage = new PlanStorage();
    vi.clearAllMocks();
  });

  describe("createTrainingPlan", () => {
    it("should insert a plan and return it", async () => {
      const mockPlan = { id: "plan-1", userId: "u1", name: "My Plan", totalWeeks: 8 };
      mockInsertChain([mockPlan]);

      const result = await storage.createTrainingPlan({ userId: "u1", name: "My Plan", totalWeeks: 8, sourceFileName: null });
      expect(result).toEqual(mockPlan);
      expect(db.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe("listTrainingPlans", () => {
    it("should return all plans for a user", async () => {
      const mockPlans = [{ id: "plan-1", userId: "u1", name: "Plan A" }, { id: "plan-2", userId: "u1", name: "Plan B" }];
      mockSelectChain(mockPlans);

      const result = await storage.listTrainingPlans("u1");
      expect(result).toEqual(mockPlans);
    });
  });

  describe("getTrainingPlan", () => {
    it("should return undefined when plan not found", async () => {
      mockSelectChain([]);
      expect(await storage.getTrainingPlan("nonexistent", "u1")).toBeUndefined();
    });

    it("should return plan with sorted days", async () => {
      const mockPlan = { id: "plan-1", userId: "u1", name: "Test Plan", totalWeeks: 2 };
      const mockDays = [
        { id: "d3", planId: "plan-1", weekNumber: 2, dayName: "Monday" },
        { id: "d1", planId: "plan-1", weekNumber: 1, dayName: "Wednesday" },
        { id: "d2", planId: "plan-1", weekNumber: 1, dayName: "Monday" },
      ];

      vi.mocked(db.select)
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockPlan]) }) })
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(mockDays) }) });

      const result = await storage.getTrainingPlan("plan-1", "u1");
      expect(result).toBeDefined();
      expect(result!.days).toHaveLength(3);
      expect(result!.days[0].id).toBe("d2"); // Week 1, Monday
      expect(result!.days[1].id).toBe("d1"); // Week 1, Wednesday
      expect(result!.days[2].id).toBe("d3"); // Week 2, Monday
    });
  });

  describe("renameTrainingPlan", () => {
    it("should update the plan name and return it", async () => {
      const mockUpdated = { id: "plan-1", name: "New Name" };
      mockUpdateChain([mockUpdated]);
      expect(await storage.renameTrainingPlan("plan-1", "New Name", "u1")).toEqual(mockUpdated);
    });

    it("should return undefined when plan not found", async () => {
      mockUpdateChain([]);
      expect(await storage.renameTrainingPlan("nonexistent", "Name", "u1")).toBeUndefined();
    });
  });

  describe("createPlanDays", () => {
    it("should return empty array when given empty array", async () => {
      expect(await storage.createPlanDays([])).toEqual([]);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("should insert plan days and return them", async () => {
      const mockDays = [{ id: "d1", planId: "plan-1", weekNumber: 1, dayName: "Monday" }];
      mockInsertChain(mockDays);

      const result = await storage.createPlanDays([
        { planId: "plan-1", weekNumber: 1, dayName: "Monday", focus: "Strength", mainWorkout: "Squats", status: "planned" },
      ]);
      expect(result).toEqual(mockDays);
    });
  });

  describe("deleteTrainingPlan", () => {
    it("should return false when plan not found", async () => {
      mockSelectChain([]);
      expect(await storage.deleteTrainingPlan("nonexistent", "u1")).toBe(false);
    });

    it("should delete plan and its days in a transaction", async () => {
      mockSelectChain([{ id: "plan-1" }]);
      vi.mocked(db.transaction).mockImplementation(async (callback) => {
        const mockTx = { delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({ rowCount: 1 }) }) };
        return await callback(mockTx);
      });

      expect(await storage.deleteTrainingPlan("plan-1", "u1")).toBe(true);
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("getPlanDay", () => {
    it("should return undefined when day not found", async () => {
      mockFindPlanDayFirst(undefined);
      expect(await storage.getPlanDay("nonexistent", "u1")).toBeUndefined();
    });

    it("should return undefined when day belongs to a different user", async () => {
      mockFindPlanDayFirst({ id: "d1", plan: { userId: "other-user" } });
      expect(await storage.getPlanDay("d1", "u1")).toBeUndefined();
    });

    it("should return the plan day when found", async () => {
      mockFindPlanDayFirst({ id: "d1", plan: { userId: "u1" } });
      const result = await storage.getPlanDay("d1", "u1");
      expect(result).toMatchObject({ id: "d1" });
      // The nested `plan` relation must be stripped before returning.
      expect(result).not.toHaveProperty("plan");
    });
  });

  describe("updatePlanDay", () => {
    it("should return undefined when day does not belong to user", async () => {
      mockFindPlanDayFirst(undefined);
      expect(await storage.updatePlanDay("d1", { focus: "Running" }, "u1")).toBeUndefined();
      expect(db.update).not.toHaveBeenCalled();
    });

    it("should update and return the plan day when found", async () => {
      mockFindPlanDayFirst({ id: "d1", plan: { userId: "u1" } });
      const updatedDay = { id: "d1", focus: "Running" };
      mockUpdateChain([updatedDay]);

      expect(await storage.updatePlanDay("d1", { focus: "Running" }, "u1")).toEqual(updatedDay);
    });
  });

  describe("deletePlanDay", () => {
    it("should return false when day not found", async () => {
      mockFindPlanDayFirst(undefined);
      expect(await storage.deletePlanDay("nonexistent", "u1")).toBe(false);
    });

    it("should delete the day and return true when found", async () => {
      mockFindPlanDayFirst({ id: "d1", plan: { userId: "u1" } });
      vi.mocked(db.delete).mockReturnValue({ where: vi.fn().mockResolvedValue({ rowCount: 1 }) });

      expect(await storage.deletePlanDay("d1", "u1")).toBe(true);
    });
  });

  describe("applyRaceDayAdjustments", () => {
    const planDay = (
      id: string,
      scheduledDate: string | null,
      overrides: Record<string, unknown> = {},
    ) => ({
      id,
      planId: "plan-1",
      weekNumber: 1,
      dayName: "Monday",
      focus: "Strength",
      mainWorkout: "Back squat 3x5",
      accessory: null,
      notes: null,
      scheduledDate,
      status: "planned",
      ...overrides,
    });

    it("returns false when the plan is not found", async () => {
      mockSelectChain([]);
      expect(await storage.applyRaceDayAdjustments("nope", "2026-07-11", "u1")).toBe(false);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("does nothing when the plan has no scheduled days", async () => {
      mockPlanWithDays({ id: "plan-1", userId: "u1" }, [planDay("d1", null)]);
      expect(await storage.applyRaceDayAdjustments("plan-1", "2026-07-11", "u1")).toBe(true);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("reserves the race day, shakeout, and recovery when the race is within range", async () => {
      mockPlanWithDays({ id: "plan-1", userId: "u1" }, [
        planDay("d1", "2026-07-09", { focus: "Intervals" }),
        planDay("d2", "2026-07-10", { focus: "Tempo Run" }), // day before the race
        planDay("d3", "2026-07-11", { focus: "Upper Strength" }), // race day
        planDay("d4", "2026-07-12", { focus: "Rest", mainWorkout: "Complete rest" }), // after race
      ]);
      const { tx, setPayloads, insertValues } = makeRecordingTx();
      vi.mocked(db.transaction).mockImplementation(async (cb) => cb(tx));

      expect(await storage.applyRaceDayAdjustments("plan-1", "2026-07-11", "u1")).toBe(true);

      const racePayload = setPayloads.find((p) => p.focus === "Race Day");
      expect(racePayload).toMatchObject({ focus: "Race Day", accessory: null, status: "planned" });
      expect(String(racePayload?.mainWorkout)).toMatch(/HYROX/i);
      expect(setPayloads.some((p) => p.focus === "Shakeout")).toBe(true);
      expect(setPayloads.some((p) => p.focus === "Recovery")).toBe(true);
      // A day matched the race date, so nothing is appended...
      expect(insertValues).toHaveLength(0);
      // ...and the plan's start/end dates are never rewritten.
      expect(setPayloads.some((p) => "startDate" in p || "endDate" in p)).toBe(false);
      // Converted days had their exercise/structure rows cleared.
      expect(tx.delete).toHaveBeenCalled();
    });

    it("creates no recovery day when the race is the last scheduled day", async () => {
      mockPlanWithDays({ id: "plan-1", userId: "u1" }, [
        planDay("d1", "2026-07-10", { focus: "Tempo Run" }),
        planDay("d2", "2026-07-11", { focus: "Upper Strength" }), // race day, last day
      ]);
      const { tx, setPayloads, insertValues } = makeRecordingTx();
      vi.mocked(db.transaction).mockImplementation(async (cb) => cb(tx));

      await storage.applyRaceDayAdjustments("plan-1", "2026-07-11", "u1");

      expect(setPayloads.some((p) => p.focus === "Race Day")).toBe(true);
      expect(setPayloads.some((p) => p.focus === "Shakeout")).toBe(true);
      expect(setPayloads.some((p) => p.focus === "Recovery")).toBe(false);
      expect(insertValues).toHaveLength(0);
    });

    it("appends a race-day entry when the plan ends before the race (undershoot)", async () => {
      mockPlanWithDays({ id: "plan-1", userId: "u1" }, [
        planDay("d1", "2026-07-05", { weekNumber: 6, focus: "Long Run" }),
      ]);
      const { tx, setPayloads, insertValues } = makeRecordingTx();
      vi.mocked(db.transaction).mockImplementation(async (cb) => cb(tx));

      await storage.applyRaceDayAdjustments("plan-1", "2026-07-08", "u1");

      expect(insertValues).toHaveLength(1);
      expect(insertValues[0]).toMatchObject({
        scheduledDate: "2026-07-08",
        focus: "Race Day",
        dayName: "Wednesday", // UTC weekday of 2026-07-08
        weekNumber: 6,
        status: "planned",
      });
      // Nothing to convert (no match, no day-before, no after-race days).
      expect(setPayloads).toHaveLength(0);
    });
  });
});
