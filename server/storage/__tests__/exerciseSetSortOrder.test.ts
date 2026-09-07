import { planDays } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { WorkoutStorage } from "../workouts";

vi.mock("../../db", () => {
  const db: Record<string, unknown> = { insert: vi.fn(), select: vi.fn() };
  // The mocked transaction hands the callback the same object, so per-test
  // mockReturnValue setups on db.select/db.insert apply inside it.
  db.transaction = vi.fn((cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  return { db };
});

/**
 * `addExerciseSetNormalized` derives sortOrder from the container's current MAX
 * inside the INSERT. Under READ COMMITTED that subquery cannot see another
 * transaction's uncommitted row, so two inserts racing on the same container
 * both read the same MAX and both land on N — after which the two sets have no
 * defined order relative to each other, and the next insert collides with them
 * too. Tapping "add set" twice is enough. The fix is a row lock on the
 * container, matching what seedExerciseSetsFromPlanDay already does for the
 * same reason; these tests pin that the lock is taken, on the right row, and
 * that it still does the ownership job the un-locked read used to do.
 */

describe("WorkoutStorage.addExerciseSetNormalized — container lock", () => {
  let storage: WorkoutStorage;

  beforeEach(() => {
    storage = new WorkoutStorage();
    vi.clearAllMocks();
  });

  /** `select().from()[.innerJoin()].where().for(...).limit()`, recording `.for(...)`. */
  function lockChain(rows: unknown[]) {
    const limit = vi.fn().mockResolvedValue(rows);
    const forMock = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ for: forMock });
    const innerJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ where, innerJoin });
    vi.mocked(db.select).mockReturnValueOnce({ from } as never);
    return { for: forMock, innerJoin };
  }

  function mockInsertReturning(rows: unknown[]) {
    const returning = vi.fn().mockResolvedValue(rows);
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({ returning }),
    } as never);
  }

  const CREATED = {
    id: "set-9",
    workoutLogId: "workout-1",
    planDayId: null,
    blockId: null,
    stepNumber: null,
    sortOrder: 3,
  };

  it("row-locks the workout before deriving sortOrder from its current MAX", async () => {
    const lock = lockChain([{ id: "workout-1" }]);
    mockInsertReturning([CREATED]);

    const created = await storage.addExerciseSetNormalized(
      { kind: "workout", id: "workout-1", userId: "user-1" },
      { exerciseName: "back_squat", category: "strength", setNumber: 1 },
    );

    expect(created).toMatchObject({ id: "set-9" });
    expect(lock.for).toHaveBeenCalledWith("update");
    // The lock is only worth anything inside the transaction that inserts.
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("locks the plan day itself, not the training plan it belongs to", async () => {
    // Locking the joined training_plans row would serialize inserts across
    // every day in the plan instead of just the one being written.
    const lock = lockChain([{ id: "plan-day-1" }]);
    mockInsertReturning([{ ...CREATED, workoutLogId: null, planDayId: "plan-day-1" }]);

    await storage.addExerciseSetNormalized(
      { kind: "planDay", id: "plan-day-1", userId: "user-1" },
      { exerciseName: "run_1k", category: "running", setNumber: 1 },
    );

    expect(lock.innerJoin).toHaveBeenCalledTimes(1);
    const call = lock.for.mock.calls[0] as [string, { of?: unknown } | undefined];
    expect(call[0]).toBe("update");
    expect(call[1]?.of).toBe(planDays);
  });

  it("inserts nothing when the locking read finds no container for this user", async () => {
    // The lock replaced the old ownership read rather than joining it, so an
    // unowned or missing container must still be a clean undefined.
    lockChain([]);
    mockInsertReturning([CREATED]);

    const created = await storage.addExerciseSetNormalized(
      { kind: "workout", id: "workout-1", userId: "someone-else" },
      { exerciseName: "back_squat", category: "strength", setNumber: 1 },
    );

    expect(created).toBeUndefined();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
