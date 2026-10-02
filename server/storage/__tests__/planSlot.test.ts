import { describe, expect, it, vi } from "vitest";

import type { DbExecutor } from "../../db";
import { planSlotFor, planSlotForMove } from "../planSlot";

// Week 1's Monday is 2026-08-31, so week 5 runs Mon Sep 28 – Sun Oct 4 and
// week 6 starts Mon Oct 5.
const START = "2026-08-31";

describe("planSlotFor", () => {
  it("gives the week and weekday a date falls in, counted from week 1's Monday", () => {
    expect(planSlotFor(START, 1, "2026-08-31")).toEqual({ weekNumber: 1, dayName: "Monday" });
    expect(planSlotFor(START, 1, "2026-10-03")).toEqual({ weekNumber: 5, dayName: "Saturday" });
    expect(planSlotFor(START, 1, "2026-10-04")).toEqual({ weekNumber: 5, dayName: "Sunday" });
    expect(planSlotFor(START, 1, "2026-10-05")).toEqual({ weekNumber: 6, dayName: "Monday" });
  });

  it("counts from the Monday of the start date's week when the plan starts mid-week", () => {
    expect(planSlotFor("2026-09-02", 1, "2026-08-31")).toEqual({ weekNumber: 1, dayName: "Monday" });
    expect(planSlotFor("2026-09-02", 1, "2026-09-07")).toEqual({ weekNumber: 2, dayName: "Monday" });
  });

  it("keeps a plan's own numbering when its weeks don't start at 1", () => {
    expect(planSlotFor(START, 3, "2026-09-10")).toEqual({ weekNumber: 4, dayName: "Thursday" });
  });

  it("puts a date before week 1 in the first week", () => {
    expect(planSlotFor(START, 1, "2026-08-20")).toEqual({ weekNumber: 1, dayName: "Thursday" });
  });
});

/** An executor whose one query (the plan's start date and first week) answers `rows`. */
function executorAnswering(rows: Array<{ startDate: string | null; firstWeek: number | null }>) {
  const groupBy = vi.fn().mockResolvedValue(rows);
  const select = vi.fn(() => ({
    from: () => ({ leftJoin: () => ({ where: () => ({ groupBy }) }) }),
  }));
  return { executor: { select } as unknown as DbExecutor, select };
}

describe("planSlotForMove", () => {
  it("reads nothing for a write that sets no date or clears it", async () => {
    const { executor, select } = executorAnswering([{ startDate: START, firstWeek: 1 }]);

    await expect(planSlotForMove(executor, "plan-1", undefined)).resolves.toBeUndefined();
    await expect(planSlotForMove(executor, "plan-1", null)).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });

  it("gives the new date's week and weekday from the plan's start and first week", async () => {
    const { executor } = executorAnswering([{ startDate: START, firstWeek: 1 }]);

    await expect(planSlotForMove(executor, "plan-1", "2026-10-05")).resolves.toEqual({ weekNumber: 6, dayName: "Monday" });
  });

  it("leaves the slot alone when the plan has never been scheduled", async () => {
    await expect(planSlotForMove(executorAnswering([{ startDate: null, firstWeek: 1 }]).executor, "plan-1", "2026-10-05")).resolves.toBeUndefined();
    await expect(planSlotForMove(executorAnswering([]).executor, "plan-1", "2026-10-05")).resolves.toBeUndefined();
  });

  it("counts from week 1 when the plan has no days to read a first week from", async () => {
    const { executor } = executorAnswering([{ startDate: START, firstWeek: null }]);

    await expect(planSlotForMove(executor, "plan-1", "2026-09-07")).resolves.toEqual({ weekNumber: 2, dayName: "Monday" });
  });
});
