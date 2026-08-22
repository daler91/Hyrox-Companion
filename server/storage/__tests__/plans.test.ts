import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach,beforeEach,describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { PlanStorage } from "../plans";

vi.mock("../../db", () => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
    selectDistinct: vi.fn(),
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
  return { setMock, whereMock, returningMock };
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

  describe("failStalePlanGenerations", () => {
    it("flips stuck plans to failed and returns the count", async () => {
      const { setMock } = mockUpdateChain([{ id: "plan-1" }, { id: "plan-2" }]);

      const count = await storage.failStalePlanGenerations(60 * 60 * 1000);

      expect(count).toBe(2);
      expect(db.update).toHaveBeenCalledTimes(1);
      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({ generationStatus: "failed" }),
      );
    });

    it("returns 0 when no plan generation is stale", async () => {
      mockUpdateChain([]);
      expect(await storage.failStalePlanGenerations(60 * 60 * 1000)).toBe(0);
    });
  });
});

describe("PlanStorage.markMissedPlanDays", () => {
  let storage: PlanStorage;
  let whereClauses: unknown[];
  let whereMock: ReturnType<typeof vi.fn>;

  // Mock the three chains the sweep drives: the distinct-zone read, the
  // per-zone plan-id subquery (never executed — it is passed to inArray), and
  // the UPDATE whose WHERE we capture to prove which date each zone compared.
  function primeSweep(zones: { tz: string }[], updatedPerZone = 1) {
    vi.mocked(db.selectDistinct).mockReturnValue({
      from: vi.fn().mockResolvedValue(zones),
    } as never);
    vi.mocked(db.select).mockReturnValue({
      from: () => ({ innerJoin: () => ({ where: () => ({}) }) }),
    } as never);
    const returningMock = vi
      .fn()
      .mockResolvedValue(Array.from({ length: updatedPerZone }, (_, i) => ({ id: `pd-${i}` })));
    whereMock = vi.fn((clause: unknown) => {
      whereClauses.push(clause);
      return { returning: returningMock };
    });
    vi.mocked(db.update).mockReturnValue({ set: () => ({ where: whereMock }) } as never);
  }

  function comparedDates(): string[] {
    const dialect = new PgDialect();
    return whereClauses.map((clause) => {
      const params = dialect.sqlToQuery(clause as never).params;
      return params.find(
        (p) => typeof p === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p),
      ) as string;
    });
  }

  beforeEach(() => {
    storage = new PlanStorage();
    vi.clearAllMocks();
    whereClauses = [];
    // 2026-07-21T01:00Z = 2026-07-20 18:00 in Los Angeles.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T01:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("compares each timezone cohort against its own local date", async () => {
    primeSweep([{ tz: "UTC" }, { tz: "America/Los_Angeles" }]);

    const marked = await storage.markMissedPlanDays();

    expect(marked).toBe(2); // one row per zone from the stubbed RETURNING
    expect(whereMock).toHaveBeenCalledTimes(2);
    // The whole point: the LA cohort is judged against 07-20, so a day
    // scheduled 07-20 is NOT swept while that athlete's day is still running.
    expect(comparedDates()).toEqual(["2026-07-21", "2026-07-20"]);
  });

  it("keeps sweeping other cohorts when one stored timezone is unusable", async () => {
    primeSweep([{ tz: "Mars/Olympus_Mons" }, { tz: "America/Los_Angeles" }]);

    const marked = await storage.markMissedPlanDays();

    // The bad zone degrades to UTC instead of aborting the statement for
    // everyone, which `AT TIME ZONE u.user_timezone` in SQL would have done.
    expect(marked).toBe(2);
    expect(comparedDates()).toEqual(["2026-07-21", "2026-07-20"]);
  });
});

// -- getPlanWeeklyDensity (audit L13) -----------------------------------------

describe("getPlanWeeklyDensity", () => {
  let storage: PlanStorage;

  /** Mock the .select().from().leftJoin().where().groupBy() chain. */
  function mockDensityChain(rows: unknown[]) {
    const groupByMock = vi.fn().mockResolvedValue(rows);
    const whereMock = vi.fn().mockReturnValue({ groupBy: groupByMock });
    const leftJoinMock = vi.fn().mockReturnValue({ where: whereMock });
    const fromMock = vi.fn().mockReturnValue({ leftJoin: leftJoinMock });
    vi.mocked(db.select).mockReturnValue({ from: fromMock });
  }

  beforeEach(() => {
    storage = new PlanStorage();
    vi.clearAllMocks();
  });

  it("reports the true average, not the rounded-up one", async () => {
    // 10 scheduled days across 4 weeks is 2.5 per week. Math.ceil reported 3.
    mockDensityChain([{ planDayCount: 10, totalWeeks: 4 }]);

    expect(await storage.getPlanWeeklyDensity("plan-1")).toBe(2.5);
  });

  it("lets the S4 warning fire on the case that used to silence it", async () => {
    // The hint is `weeklyGoal > planWeeklyDensity`. At the old ceil'd 3, a goal
    // of 3 compared 3 > 3 and stayed quiet, so the athlete never learned why
    // their completion rate capped at 2.5/3 = 83%.
    mockDensityChain([{ planDayCount: 10, totalWeeks: 4 }]);
    const density = await storage.getPlanWeeklyDensity("plan-1");

    expect(Math.ceil(10 / 4)).toBe(3);
    expect(3 > Math.ceil(10 / 4)).toBe(false); // the old, silent comparison
    expect(3 > density!).toBe(true); // the warning the S4 hint exists to raise
  });

  it("still stays quiet when the plan really does cover the goal", async () => {
    // 20 days over 4 weeks is 5 per week; a goal of 5 is met exactly and must
    // not warn. Returning a real number must not turn the hint into a nag.
    mockDensityChain([{ planDayCount: 20, totalWeeks: 4 }]);

    expect(5 > (await storage.getPlanWeeklyDensity("plan-1"))!).toBe(false);
  });

  it("does not let float representation decide the comparison", async () => {
    // 10/3 is 3.3333333333333335 in IEEE-754. Rounding to 2 dp keeps an
    // exactly-matched goal from reading as exceeding the plan on the last bit.
    mockDensityChain([{ planDayCount: 9, totalWeeks: 3 }]);

    expect(await storage.getPlanWeeklyDensity("plan-1")).toBe(3);
    expect(3 > (await storage.getPlanWeeklyDensity("plan-1"))!).toBe(false);
  });

  it("returns a zero density for a plan whose days were all deleted", async () => {
    // The LEFT JOIN exists so this is 0, not "plan not found" — a goal of any
    // size then exceeds it, which is the honest answer.
    mockDensityChain([{ planDayCount: 0, totalWeeks: 8 }]);

    expect(await storage.getPlanWeeklyDensity("plan-1")).toBe(0);
  });

  it("returns undefined when the plan never had totalWeeks set", async () => {
    mockDensityChain([{ planDayCount: 12, totalWeeks: null }]);

    expect(await storage.getPlanWeeklyDensity("plan-1")).toBeUndefined();
  });
});
