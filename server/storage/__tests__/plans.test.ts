import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlanStorage } from "../plans";
import { db } from "../../db";

vi.mock("../../db", () => ({
  db: { insert: vi.fn(), update: vi.fn(), delete: vi.fn(), select: vi.fn(), transaction: vi.fn() },
}));

vi.mock("../../storage", () => ({ storage: {} }));

// -- Helpers ------------------------------------------------------------------

function mockSelectChain(result: unknown[]) {
  const whereMock = vi.fn().mockResolvedValue(result);
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);
  return { fromMock, whereMock };
}

function mockSelectWithJoin(result: unknown[]) {
  const whereMock = vi.fn().mockResolvedValue(result);
  const innerJoinMock = vi.fn().mockReturnValue({ where: whereMock });
  const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock });
  vi.mocked(db.select).mockReturnValue({ from: fromMock } as never);
}

function mockInsertChain(result: unknown[]) {
  const returningMock = vi.fn().mockResolvedValue(result);
  const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
  vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as never);
}

function mockUpdateChain(result: unknown[]) {
  const returningMock = vi.fn().mockResolvedValue(result);
  const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
  const setMock = vi.fn().mockReturnValue({ where: whereMock });
  vi.mocked(db.update).mockReturnValue({ set: setMock } as never);
}

function mockUpdateWithFromChain(result: unknown[]) {
  const returningMock = vi.fn().mockResolvedValue(result);
  const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  const setMock = vi.fn().mockReturnValue({ from: fromMock });
  vi.mocked(db.update).mockReturnValue({ set: setMock } as never);
}

function mockDeleteWithSubqueryChain(rowCount: number) {
  // Mock db.select() for the subquery inside inArray()
  const subqueryWhereMock = vi.fn().mockReturnValue("subquery");
  const subqueryFromMock = vi.fn().mockReturnValue({ where: subqueryWhereMock });
  vi.mocked(db.select).mockReturnValue({ from: subqueryFromMock } as never);
  // Mock db.delete() for the main DELETE
  const deletWhereMock = vi.fn().mockResolvedValue({ rowCount });
  vi.mocked(db.delete).mockReturnValue({ where: deletWhereMock } as never);
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
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockPlan]) }) } as never)
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(mockDays) }) } as never);

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
      ] as never);
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
        return await callback(mockTx as never);
      });

      expect(await storage.deleteTrainingPlan("plan-1", "u1")).toBe(true);
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("getPlanDay", () => {
    it("should return undefined when day not found", async () => {
      mockSelectWithJoin([]);
      expect(await storage.getPlanDay("nonexistent", "u1")).toBeUndefined();
    });

    it("should return the plan day when found", async () => {
      const mockDay = { id: "d1", planId: "plan-1", weekNumber: 1 };
      mockSelectWithJoin([{ planDay: mockDay }]);
      expect(await storage.getPlanDay("d1", "u1")).toEqual(mockDay);
    });
  });

  describe("updatePlanDay", () => {
    it("should return undefined when day does not belong to user", async () => {
      mockUpdateWithFromChain([]);
      expect(await storage.updatePlanDay("d1", { focus: "Running" }, "u1")).toBeUndefined();
    });

    it("should update and return the plan day when found", async () => {
      const updatedDay = { id: "d1", planId: "plan-1", weekNumber: 1, focus: "Running" };
      mockUpdateWithFromChain([updatedDay]);

      expect(await storage.updatePlanDay("d1", { focus: "Running" }, "u1")).toEqual(updatedDay);
    });
  });

  describe("deletePlanDay", () => {
    it("should return false when day not found", async () => {
      mockDeleteWithSubqueryChain(0);
      expect(await storage.deletePlanDay("nonexistent", "u1")).toBe(false);
    });

    it("should delete the day and return true when found", async () => {
      mockDeleteWithSubqueryChain(1);
      expect(await storage.deletePlanDay("d1", "u1")).toBe(true);
    });
  });
});
