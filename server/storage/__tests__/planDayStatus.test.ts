import { beforeEach, describe, expect, it, vi } from "vitest";

import { syncPlanDayStatusFromWorkouts } from "../planDayStatus";

vi.mock("../../db", () => ({
  db: {},
}));

function makeTxStub(opts: {
  planDayRow?: { status: string; ownerId: string };
  workoutCount?: number;
}) {
  const updateWhere = vi.fn().mockResolvedValue([]);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  // First .select() returns the locked plan_day row (via .from().innerJoin().where().for()).
  // Second .select() returns the workout_logs count (via .from().where()).
  let call = 0;
  const select = vi.fn().mockImplementation(() => {
    call++;
    if (call === 1) {
      const rows = opts.planDayRow ? [opts.planDayRow] : [];
      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue(rows),
            }),
          }),
        }),
      };
    }
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: opts.workoutCount ?? 0 }]),
      }),
    };
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

  // Cases where the helper must not issue an UPDATE. `planDayRow: null` models
  // the "row missing or wrong owner" branches (makeTxStub translates null to
  // an empty result set; a non-matching ownerId triggers the same path).
  it.each([
    { name: "plan_day does not exist", planDayRow: undefined },
    { name: "wrong owner", planDayRow: { status: "completed", ownerId: "other-user" } },
    { name: "status is 'skipped'", planDayRow: { status: "skipped", ownerId: "u1" } },
    { name: "status is 'missed'", planDayRow: { status: "missed", ownerId: "u1" } },
    {
      name: "derived status already matches",
      planDayRow: { status: "completed", ownerId: "u1" },
      workoutCount: 3,
    },
  ])("is a no-op when $name", async ({ planDayRow, workoutCount }) => {
    const { tx, update } = makeTxStub({ planDayRow, workoutCount });
    await syncPlanDayStatusFromWorkouts("pd1", "u1", tx);
    expect(update).not.toHaveBeenCalled();
  });

  // Cases where the helper must transition status.
  it.each([
    {
      name: "'completed' with zero workouts reverts to 'planned' (S6)",
      status: "completed",
      workoutCount: 0,
      expected: "planned",
    },
    {
      name: "'planned' with at least one workout promotes to 'completed'",
      status: "planned",
      workoutCount: 1,
      expected: "completed",
    },
  ])("$name", async ({ status, workoutCount, expected }) => {
    const { tx, updateSet } = makeTxStub({
      planDayRow: { status, ownerId: "u1" },
      workoutCount,
    });
    await syncPlanDayStatusFromWorkouts("pd1", "u1", tx);
    expect(updateSet).toHaveBeenCalledWith({ status: expected });
  });
});
