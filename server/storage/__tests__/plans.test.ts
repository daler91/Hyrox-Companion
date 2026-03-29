import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlanStorage } from "../plans";
import { db } from "../../db";

vi.mock("../../db", () => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
    transaction: vi.fn(),
  },
}));

// Prevent storage barrel from instantiating all storage classes
vi.mock("../../storage", () => ({
  storage: {},
}));

describe("PlanStorage", () => {
  let storage: PlanStorage;

  beforeEach(() => {
    storage = new PlanStorage();
    vi.clearAllMocks();
  });

  describe("createTrainingPlan", () => {
    it("should insert a plan and return it", async () => {
      const mockPlan = { id: "plan-1", userId: "u1", name: "My Plan", totalWeeks: 8 };
      const returningMock = vi.fn().mockResolvedValue([mockPlan]);
      const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
      vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as any);

      const result = await storage.createTrainingPlan({
        userId: "u1",
        name: "My Plan",
        totalWeeks: 8,
        sourceFileName: null,
      });

      expect(result).toEqual(mockPlan);
      expect(db.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe("listTrainingPlans", () => {
    it("should return all plans for a user", async () => {
      const mockPlans = [
        { id: "plan-1", userId: "u1", name: "Plan A" },
        { id: "plan-2", userId: "u1", name: "Plan B" },
      ];
      const whereMock = vi.fn().mockResolvedValue(mockPlans);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock } as any);

      const result = await storage.listTrainingPlans("u1");

      expect(result).toEqual(mockPlans);
      expect(db.select).toHaveBeenCalledTimes(1);
    });
  });

  describe("getTrainingPlan", () => {
    it("should return undefined when plan not found", async () => {
      const whereMock = vi.fn().mockResolvedValue([]);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock } as any);

      const result = await storage.getTrainingPlan("nonexistent", "u1");

      expect(result).toBeUndefined();
    });

    it("should return plan with sorted days", async () => {
      const mockPlan = { id: "plan-1", userId: "u1", name: "Test Plan", totalWeeks: 2 };
      const mockDays = [
        { id: "d3", planId: "plan-1", weekNumber: 2, dayName: "Monday" },
        { id: "d1", planId: "plan-1", weekNumber: 1, dayName: "Wednesday" },
        { id: "d2", planId: "plan-1", weekNumber: 1, dayName: "Monday" },
      ];

      // First call: get the plan
      // Second call: get the days
      const whereMockPlan = vi.fn().mockResolvedValue([mockPlan]);
      const fromMockPlan = vi.fn().mockReturnValue({ where: whereMockPlan });

      const whereMockDays = vi.fn().mockResolvedValue(mockDays);
      const fromMockDays = vi.fn().mockReturnValue({ where: whereMockDays });

      vi.mocked(db.select)
        .mockReturnValueOnce({ from: fromMockPlan } as any)
        .mockReturnValueOnce({ from: fromMockDays } as any);

      const result = await storage.getTrainingPlan("plan-1", "u1");

      expect(result).toBeDefined();
      expect(result!.days).toHaveLength(3);
      // Sorted: Week 1 Monday, Week 1 Wednesday, Week 2 Monday
      expect(result!.days[0].id).toBe("d2"); // Week 1, Monday
      expect(result!.days[1].id).toBe("d1"); // Week 1, Wednesday
      expect(result!.days[2].id).toBe("d3"); // Week 2, Monday
    });
  });

  describe("renameTrainingPlan", () => {
    it("should update the plan name and return it", async () => {
      const mockUpdated = { id: "plan-1", name: "New Name" };
      const returningMock = vi.fn().mockResolvedValue([mockUpdated]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.update).mockReturnValue({ set: setMock } as any);

      const result = await storage.renameTrainingPlan("plan-1", "New Name", "u1");

      expect(result).toEqual(mockUpdated);
    });

    it("should return undefined when plan not found", async () => {
      const returningMock = vi.fn().mockResolvedValue([]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.update).mockReturnValue({ set: setMock } as any);

      const result = await storage.renameTrainingPlan("nonexistent", "Name", "u1");

      expect(result).toBeUndefined();
    });
  });

  describe("createPlanDays", () => {
    it("should return empty array when given empty array", async () => {
      const result = await storage.createPlanDays([]);

      expect(result).toEqual([]);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("should insert plan days and return them", async () => {
      const mockDays = [
        { id: "d1", planId: "plan-1", weekNumber: 1, dayName: "Monday" },
      ];
      const returningMock = vi.fn().mockResolvedValue(mockDays);
      const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
      vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as any);

      const result = await storage.createPlanDays([
        { planId: "plan-1", weekNumber: 1, dayName: "Monday", focus: "Strength", mainWorkout: "Squats", status: "planned" },
      ] as any);

      expect(result).toEqual(mockDays);
    });
  });

  describe("deleteTrainingPlan", () => {
    it("should return false when plan not found", async () => {
      const whereMock = vi.fn().mockResolvedValue([]);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock } as any);

      const result = await storage.deleteTrainingPlan("nonexistent", "u1");

      expect(result).toBe(false);
    });

    it("should delete plan and its days in a transaction", async () => {
      // Mock the select to find the plan
      const whereMock = vi.fn().mockResolvedValue([{ id: "plan-1" }]);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock } as any);

      // Mock the transaction
      vi.mocked(db.transaction).mockImplementation(async (callback) => {
        const mockTx = {
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue({ rowCount: 1 }),
          }),
        };
        return await callback(mockTx as any);
      });

      const result = await storage.deleteTrainingPlan("plan-1", "u1");

      expect(result).toBe(true);
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("getPlanDay", () => {
    it("should return undefined when day not found", async () => {
      const whereMock = vi.fn().mockResolvedValue([]);
      const innerJoinMock = vi.fn().mockReturnValue({ where: whereMock });
      const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock } as any);

      const result = await storage.getPlanDay("nonexistent", "u1");

      expect(result).toBeUndefined();
    });

    it("should return the plan day when found", async () => {
      const mockDay = { id: "d1", planId: "plan-1", weekNumber: 1 };
      const whereMock = vi.fn().mockResolvedValue([{ planDay: mockDay }]);
      const innerJoinMock = vi.fn().mockReturnValue({ where: whereMock });
      const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock } as any);

      const result = await storage.getPlanDay("d1", "u1");

      expect(result).toEqual(mockDay);
    });
  });

  describe("updatePlanDay", () => {
    it("should return undefined when day does not belong to user", async () => {
      // Mock getPlanDay to return undefined
      const whereMock = vi.fn().mockResolvedValue([]);
      const innerJoinMock = vi.fn().mockReturnValue({ where: whereMock });
      const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock } as any);

      const result = await storage.updatePlanDay("d1", { focus: "Running" }, "u1");

      expect(result).toBeUndefined();
      expect(db.update).not.toHaveBeenCalled();
    });

    it("should update and return the plan day when found", async () => {
      const mockDay = { id: "d1", planId: "plan-1", weekNumber: 1 };
      const updatedDay = { ...mockDay, focus: "Running" };

      // Mock getPlanDay
      const whereMockSelect = vi.fn().mockResolvedValue([{ planDay: mockDay }]);
      const innerJoinMock = vi.fn().mockReturnValue({ where: whereMockSelect });
      const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock } as any);

      // Mock update
      const returningMock = vi.fn().mockResolvedValue([updatedDay]);
      const whereMockUpdate = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMockUpdate });
      vi.mocked(db.update).mockReturnValue({ set: setMock } as any);

      const result = await storage.updatePlanDay("d1", { focus: "Running" }, "u1");

      expect(result).toEqual(updatedDay);
    });
  });

  describe("deletePlanDay", () => {
    it("should return false when day not found", async () => {
      const whereMock = vi.fn().mockResolvedValue([]);
      const innerJoinMock = vi.fn().mockReturnValue({ where: whereMock });
      const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock } as any);

      const result = await storage.deletePlanDay("nonexistent", "u1");

      expect(result).toBe(false);
    });

    it("should delete the day and return true when found", async () => {
      const mockDay = { id: "d1" };
      const whereMockSelect = vi.fn().mockResolvedValue([{ planDay: mockDay }]);
      const innerJoinMock = vi.fn().mockReturnValue({ where: whereMockSelect });
      const fromMock = vi.fn().mockReturnValue({ innerJoin: innerJoinMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock } as any);

      const whereMockDelete = vi.fn().mockResolvedValue({ rowCount: 1 });
      vi.mocked(db.delete).mockReturnValue({ where: whereMockDelete } as any);

      const result = await storage.deletePlanDay("d1", "u1");

      expect(result).toBe(true);
    });
  });
});
