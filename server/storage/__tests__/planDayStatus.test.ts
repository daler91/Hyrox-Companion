import { beforeEach, describe, expect, it, vi } from "vitest";

import { syncPlanDayStatusesFromWorkouts, syncPlanDayStatusFromWorkouts } from "../planDayStatus";

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

  // The helper's tx param is a Drizzle executor; the test only needs .select
  // and .update to return the stubbed chains. Narrow to the minimal shape to
  // avoid stacking double casts.
  type MinimalTx = Parameters<typeof syncPlanDayStatusFromWorkouts>[2];
  const tx = { select, update } as unknown as MinimalTx;
  return { tx, updateSet, update };
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

function makeManyTxStub(opts: {
  lockedRows?: Array<{ id: string; status: string; ownerId: string }>;
  counts?: Array<{ planDayId: string; count: number }>;
}) {
  const updateWhere = vi.fn().mockResolvedValue([]);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  // First .select() locks the candidate plan_day rows (via
  // .from().innerJoin().where().for()). Second .select() returns the grouped
  // workout_logs counts (via .from().where().groupBy()).
  let call = 0;
  const select = vi.fn().mockImplementation(() => {
    call++;
    if (call === 1) {
      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue(opts.lockedRows ?? []),
            }),
          }),
        }),
      };
    }
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockResolvedValue(opts.counts ?? []),
        }),
      }),
    };
  });

  type MinimalTx = Parameters<typeof syncPlanDayStatusesFromWorkouts>[2];
  const tx = { select, update } as unknown as MinimalTx;
  return { tx, select, update, updateSet, updateWhere };
}

describe("syncPlanDayStatusesFromWorkouts (batched)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a no-op and never touches tx when given no ids", async () => {
    const { tx, select, update } = makeManyTxStub({});
    await syncPlanDayStatusesFromWorkouts([], "u1", tx);
    expect(select).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("skips the count query and update when no row is eligible", async () => {
    const { tx, select, update } = makeManyTxStub({
      lockedRows: [
        { id: "pd1", status: "skipped", ownerId: "u1" },
        { id: "pd2", status: "completed", ownerId: "other-user" },
      ],
    });
    await syncPlanDayStatusesFromWorkouts(["pd1", "pd2"], "u1", tx);
    expect(select).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("batches mixed transitions into at most one UPDATE per target status", async () => {
    const { tx, updateSet, updateWhere } = makeManyTxStub({
      lockedRows: [
        { id: "pd1", status: "planned", ownerId: "u1" }, // -> completed (has a workout)
        { id: "pd2", status: "completed", ownerId: "u1" }, // -> planned (workout removed)
        { id: "pd3", status: "planned", ownerId: "u1" }, // stays planned (already correct)
        { id: "pd4", status: "skipped", ownerId: "u1" }, // never touched
      ],
      counts: [{ planDayId: "pd1", count: 2 }],
    });

    await syncPlanDayStatusesFromWorkouts(["pd1", "pd2", "pd3", "pd4"], "u1", tx);

    expect(updateSet).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenCalledWith({ status: "completed" });
    expect(updateSet).toHaveBeenCalledWith({ status: "planned" });
    expect(updateWhere).toHaveBeenCalledTimes(2);
  });
});
