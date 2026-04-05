import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock drizzle-orm and other modules BEFORE importing PlanStorage
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  sql: Object.assign(vi.fn((strings, ...values) => ({ strings, values })), {
    raw: vi.fn((val) => `RAW:${val}`),
    join: vi.fn((chunks, sep) => ({ chunks, sep, type: 'join' })),
  }),
  inArray: vi.fn(),
  isNotNull: vi.fn(),
}));

vi.mock("@shared/schema", () => ({
  trainingPlans: { id: { name: 'id' } },
  planDays: { id: { name: 'id' } },
}));

vi.mock("../../db", () => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
    transaction: vi.fn()
  },
}));

// We need to mock ../types too as it is imported by plans.ts
vi.mock("../types", () => ({
  toDateStr: vi.fn((d) => d ? d.toISOString().split('T')[0] : '2023-10-02'),
}));

import { PlanStorage } from "../plans";
import { trainingPlans, planDays } from "@shared/schema";
import { db } from "../../db";

describe("PlanStorage.schedulePlan", () => {
  let storage: PlanStorage;

  beforeEach(() => {
    storage = new PlanStorage();
    vi.clearAllMocks();
  });

  it("should schedule a plan and update dates in a transaction", async () => {
    const mockPlan = {
      id: "plan-1",
      userId: "u1",
      name: "Test Plan",
      totalWeeks: 1,
      days: [
        { id: "d1", planId: "plan-1", weekNumber: 1, dayName: "Monday", status: "planned" },
      ]
    };

    // Mock storage.getTrainingPlan internal call
    // Since we are testing schedulePlan, and it calls this.getTrainingPlan
    vi.spyOn(storage, 'getTrainingPlan').mockResolvedValue(mockPlan as any);

    // Mock transaction
    const mockTx = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({ rowCount: 1 })
        })
      })
    };
    vi.mocked(db.transaction).mockImplementation(async (cb) => cb(mockTx as any));

    const result = await storage.schedulePlan("plan-1", "2023-10-02", "u1");

    expect(result).toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.update).toHaveBeenCalledWith(planDays);
    expect(mockTx.update).toHaveBeenCalledWith(trainingPlans);
  });
});
