import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockPlanDay } from "../../test/factories";
import type { db } from "../db";
import { invalidateAnalyticsCachesForUser } from "./analyticsRouteCache";
import { updatePlanDayStatus } from "./planService";

/**
 * D10 (CODEBASE_ANALYSIS_2026-10-03): reopening a completed plan day deletes
 * its linked log (folding the content back onto the day), unlinks any other
 * logs and releases a Strava recording to its own row. The analytics routes
 * cache the athlete's logs and sets for minutes, so that write has to drop
 * them, after the commit, like every other workout write path. The fold
 * itself is covered in planService.test.ts.
 */

const DAY_ID = "day-1";
const USER_ID = "user-1";

const { transactionMock } = vi.hoisted(() => ({ transactionMock: vi.fn<typeof db.transaction>() }));
vi.mock("../db", () => ({ db: { transaction: transactionMock } }));
vi.mock("../storage", () => ({
  storage: { plans: {}, users: { getUser: vi.fn(() => Promise.resolve()) } },
}));
vi.mock("../storage/planSlot", () => ({ planSlotForMove: vi.fn().mockResolvedValue({}) }));
vi.mock("./planDayMoves", () => ({ recordPlanDayMove: vi.fn() }));
vi.mock("./autoCoachQueue", () => ({ enqueueAutoCoachInBackground: vi.fn() }));
vi.mock("./deviceActivityLink", () => ({
  releaseStravaActivityInTx: vi.fn(),
  stripStravaActivityLabel: vi.fn(),
}));
vi.mock("./analyticsRouteCache", () => ({ invalidateAnalyticsCachesForUser: vi.fn() }));

const LINKED_LOG = { id: "log-1", focus: "Run", mainWorkout: "8 km tempo", accessory: null, notes: null, stravaActivityId: null };

/**
 * A tx for one status change from `fromStatus`: the locked status read, then
 * (only when leaving completed) the linked-log and logged-set reads, the
 * deletes, and the plan-day update. Records whether the caches had been
 * dropped by the time the transaction callback returned.
 */
function arrangeTransaction(fromStatus: string): { invalidatedInsideTx: boolean[] } {
  const selects = [
    { from: () => ({ innerJoin: () => ({ where: () => ({ for: () => Promise.resolve([{ planId: "plan-1", status: fromStatus, scheduledDate: "2026-10-01", recovery: null }]) }) }) }) },
    { from: () => ({ where: () => ({ orderBy: () => Promise.resolve([LINKED_LOG]) }) }) },
    { from: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }) },
  ];
  const tx = {
    select: vi.fn(() => selects.shift()),
    delete: vi.fn(() => ({ where: () => Promise.resolve() })),
    insert: vi.fn(() => ({ values: () => Promise.resolve() })),
    update: vi.fn(() => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([createMockPlanDay({ id: DAY_ID })]) }) }),
    })),
  };
  const invalidatedInsideTx: boolean[] = [];
  transactionMock.mockImplementation(async (callback) => {
    const result = await callback(tx as unknown as Parameters<Parameters<typeof db.transaction>[0]>[0]);
    invalidatedInsideTx.push(vi.mocked(invalidateAnalyticsCachesForUser).mock.calls.length > 0);
    return result;
  });
  return { invalidatedInsideTx };
}

describe("updatePlanDayStatus drops cached analytics when it reopens a day (D10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["planned", "skipped"] as const)("completed → %s invalidates after the commit", async (status) => {
    const { invalidatedInsideTx } = arrangeTransaction("completed");

    await updatePlanDayStatus(DAY_ID, { status }, USER_ID);

    expect(invalidateAnalyticsCachesForUser).toHaveBeenCalledWith(USER_ID);
    expect(invalidatedInsideTx).toEqual([false]);
  });

  it.each([
    ["planned", "completed"],
    ["planned", "skipped"],
    ["completed", "completed"],
  ] as const)("%s → %s leaves the caches alone (no log is touched)", async (from, status) => {
    arrangeTransaction(from);

    await updatePlanDayStatus(DAY_ID, { status }, USER_ID);

    expect(invalidateAnalyticsCachesForUser).not.toHaveBeenCalled();
  });
});
