import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { storage } from "../../storage";
import { persistAdherenceSnapshot } from "./adherence";
import { assignWorkoutPlanDay } from "./workouts";

vi.mock("../../db", () => ({ db: { transaction: vi.fn() } }));
vi.mock("../../storage", () => ({
  storage: {
    plans: {
      getPlanDay: vi.fn(),
      syncPlanDayStatusFromWorkouts: vi.fn().mockResolvedValue(undefined),
    },
  },
}));
vi.mock("./adherence", () => ({ persistAdherenceSnapshot: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../queue", () => ({
  queue: { send: vi.fn().mockResolvedValue(undefined) },
  DEFAULT_JOB_OPTIONS: {},
}));
vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type MockTx = {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateSet: ReturnType<typeof vi.fn>;
  updateWhere: ReturnType<typeof vi.fn>;
};

// select().from().where().for("update") — the locked workout lookup.
const lockedLookup = (rows: unknown[]) => ({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({ for: vi.fn().mockResolvedValue(rows) }),
  }),
});

// select().from().where() — the actual-sets fetch and the final fresh read.
const plainWhere = (rows: unknown[]) => ({
  from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rows) }),
});

function setupTx(selectSequence: Array<{ from: ReturnType<typeof vi.fn> }>): MockTx {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const select = vi.fn();
  for (const value of selectSequence) select.mockReturnValueOnce(value);
  const mockTx: MockTx = {
    select,
    update: vi.fn().mockReturnValue({ set: updateSet }),
    updateSet,
    updateWhere,
  };
  vi.mocked(db.transaction).mockImplementation(async (callback) =>
    callback(mockTx as unknown as Parameters<Parameters<typeof db.transaction>[0]>[0]),
  );
  return mockTx;
}

const WORKOUT_ID = "workout-1";
const USER_ID = "user-1";

describe("assignWorkoutPlanDay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.plans.syncPlanDayStatusFromWorkouts).mockResolvedValue(undefined);
  });

  it("returns null and skips all writes when the workout isn't owned", async () => {
    const tx = setupTx([lockedLookup([])]);

    const result = await assignWorkoutPlanDay(WORKOUT_ID, "day-1", USER_ID);

    expect(result).toBeNull();
    expect(storage.plans.getPlanDay).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(storage.plans.syncPlanDayStatusFromWorkouts).not.toHaveBeenCalled();
  });

  it("throws 404 when the target plan day isn't owned by the user", async () => {
    setupTx([lockedLookup([{ id: WORKOUT_ID, planDayId: null }])]);
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue(undefined);

    await expect(assignWorkoutPlanDay(WORKOUT_ID, "day-1", USER_ID)).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    expect(persistAdherenceSnapshot).not.toHaveBeenCalled();
  });

  it("links a standalone workout to a plan day: derives planId, snapshots adherence, syncs the new day", async () => {
    const fresh = { id: WORKOUT_ID, planId: "plan-A", planDayId: "day-1" };
    const tx = setupTx([
      lockedLookup([{ id: WORKOUT_ID, planDayId: null }]),
      plainWhere([{ id: "set-1", workoutLogId: WORKOUT_ID }]), // actual sets
      plainWhere([fresh]), // final fresh read
    ]);
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue({ id: "day-1", planId: "plan-A" } as never);

    const result = await assignWorkoutPlanDay(WORKOUT_ID, "day-1", USER_ID);

    expect(tx.updateSet).toHaveBeenCalledWith({ planId: "plan-A", planDayId: "day-1" });
    expect(persistAdherenceSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      WORKOUT_ID,
      "day-1",
      [{ id: "set-1", workoutLogId: WORKOUT_ID }],
    );
    expect(storage.plans.syncPlanDayStatusFromWorkouts).toHaveBeenCalledTimes(1);
    expect(storage.plans.syncPlanDayStatusFromWorkouts).toHaveBeenCalledWith("day-1", USER_ID, expect.anything());
    expect(result).toEqual(fresh);
  });

  it("changing days re-syncs BOTH the new day and the previously-linked day", async () => {
    setupTx([
      lockedLookup([{ id: WORKOUT_ID, planDayId: "day-old" }]),
      plainWhere([]), // actual sets (none)
      plainWhere([{ id: WORKOUT_ID, planId: "plan-B", planDayId: "day-new" }]),
    ]);
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue({ id: "day-new", planId: "plan-B" } as never);

    await assignWorkoutPlanDay(WORKOUT_ID, "day-new", USER_ID);

    expect(storage.plans.syncPlanDayStatusFromWorkouts).toHaveBeenCalledWith("day-new", USER_ID, expect.anything());
    expect(storage.plans.syncPlanDayStatusFromWorkouts).toHaveBeenCalledWith("day-old", USER_ID, expect.anything());
    expect(storage.plans.syncPlanDayStatusFromWorkouts).toHaveBeenCalledTimes(2);
  });

  it("clearing the link nulls the FKs + adherence and re-syncs the old day without snapshotting", async () => {
    const tx = setupTx([
      lockedLookup([{ id: WORKOUT_ID, planDayId: "day-old" }]),
      plainWhere([{ id: WORKOUT_ID, planId: null, planDayId: null }]),
    ]);

    await assignWorkoutPlanDay(WORKOUT_ID, null, USER_ID);

    expect(storage.plans.getPlanDay).not.toHaveBeenCalled();
    expect(persistAdherenceSnapshot).not.toHaveBeenCalled();
    expect(tx.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: null,
        planDayId: null,
        compliancePct: null,
        plannedSetCount: null,
      }),
    );
    expect(storage.plans.syncPlanDayStatusFromWorkouts).toHaveBeenCalledTimes(1);
    expect(storage.plans.syncPlanDayStatusFromWorkouts).toHaveBeenCalledWith("day-old", USER_ID, expect.anything());
  });
});
