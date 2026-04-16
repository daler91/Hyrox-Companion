import { beforeEach, describe, expect, it, vi } from "vitest";

import { syncPlanDayStatusFromWorkouts } from "../planDayStatus";

vi.mock("../../db", () => ({
  db: {},
}));

/**
 * Builds a minimal Drizzle-like executor stub whose methods return thenable
 * chains for the two SELECTs (locked plan_day + workout count) and the final
 * UPDATE. Each call returns the value supplied via the `rows` / `count` args.
 */
function makeTxStub(opts: {
  planDayRow?: { status: string; ownerId: string } | undefined;
  workoutCount?: number;
}) {
  const updateWhere = vi.fn().mockResolvedValue([]);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  // First select(): locked plan_day lookup — chain .from().innerJoin().where().for()
  // Second select(): workout count — chain .from().where()
  let call = 0;
  const select = vi.fn().mockImplementation(() => {
    call++;
    if (call === 1) {
      const rows = opts.planDayRow ? [opts.planDayRow] : [];
      const forFn = vi.fn().mockResolvedValue(rows);
      const where = vi.fn().mockReturnValue({ for: forFn });
      const innerJoin = vi.fn().mockReturnValue({ where });
      const from = vi.fn().mockReturnValue({ innerJoin });
      return { from };
    }
    const where = vi.fn().mockResolvedValue([{ count: opts.workoutCount ?? 0 }]);
    const from = vi.fn().mockReturnValue({ where });
    return { from };
  });

  return {
    tx: { select, update } as unknown as Parameters<typeof syncPlanDayStatusFromWorkouts>[2],
    updateSet,
    update,
  };
}

describe("syncPlanDayStatusFromWorkouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a no-op when the plan_day doesn't exist", async () => {
    const { tx, update } = makeTxStub({ planDayRow: undefined });
    await syncPlanDayStatusFromWorkouts("pd1", "u1", tx);
    expect(update).not.toHaveBeenCalled();
  });

  it("is a no-op when the plan_day belongs to a different user", async () => {
    const { tx, update } = makeTxStub({
      planDayRow: { status: "completed", ownerId: "other-user" },
    });
    await syncPlanDayStatusFromWorkouts("pd1", "u1", tx);
    expect(update).not.toHaveBeenCalled();
  });

  it("preserves 'skipped' status (explicit user intent)", async () => {
    const { tx, update } = makeTxStub({
      planDayRow: { status: "skipped", ownerId: "u1" },
    });
    await syncPlanDayStatusFromWorkouts("pd1", "u1", tx);
    expect(update).not.toHaveBeenCalled();
  });

  it("preserves 'missed' status (cron intent)", async () => {
    const { tx, update } = makeTxStub({
      planDayRow: { status: "missed", ownerId: "u1" },
    });
    await syncPlanDayStatusFromWorkouts("pd1", "u1", tx);
    expect(update).not.toHaveBeenCalled();
  });

  it("reverts stale 'completed' to 'planned' when no workouts remain (S6)", async () => {
    const { tx, updateSet } = makeTxStub({
      planDayRow: { status: "completed", ownerId: "u1" },
      workoutCount: 0,
    });
    await syncPlanDayStatusFromWorkouts("pd1", "u1", tx);
    expect(updateSet).toHaveBeenCalledWith({ status: "planned" });
  });

  it("promotes 'planned' to 'completed' when a workout exists", async () => {
    const { tx, updateSet } = makeTxStub({
      planDayRow: { status: "planned", ownerId: "u1" },
      workoutCount: 1,
    });
    await syncPlanDayStatusFromWorkouts("pd1", "u1", tx);
    expect(updateSet).toHaveBeenCalledWith({ status: "completed" });
  });

  it("is a no-op when the derived status matches the current status", async () => {
    const { tx, update } = makeTxStub({
      planDayRow: { status: "completed", ownerId: "u1" },
      workoutCount: 3,
    });
    await syncPlanDayStatusFromWorkouts("pd1", "u1", tx);
    expect(update).not.toHaveBeenCalled();
  });
});
