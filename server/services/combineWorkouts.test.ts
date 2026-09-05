import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { combineWorkouts } from "./combineWorkouts";

vi.mock("../db", () => ({
  db: { transaction: vi.fn() },
}));

const NEW_WORKOUT = { date: "2026-05-04", focus: "Strength", mainWorkout: "Merged session" };

describe("combineWorkouts", () => {
  // The chained drizzle builder is mocked as a single object whose terminal
  // calls resolve in program order, the same way bulkDeleteWorkouts.test.ts
  // drives its transaction.
  let mockTx: {
    select: ReturnType<typeof vi.fn>;
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    innerJoin: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    values: ReturnType<typeof vi.fn>;
    returning: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      // Terminal call of the set re-parent lookup. Defaults to "no logged
      // sets", so tests that don't care about them keep their .where() order.
      orderBy: vi.fn().mockResolvedValue([]),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: "merged", ...NEW_WORKOUT, userId: "user-1" }]),
      delete: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };
    vi.mocked(db.transaction).mockImplementation(async (callback) => callback(mockTx as never));
  });

  it("inserts the merged log, deletes the sources and returns the new row", async () => {
    // 1: source lookup; 2: source delete
    mockTx.where.mockResolvedValueOnce([{ id: "w1", planDayId: null }, { id: "w2", planDayId: null }]);
    // Set re-parent lookup chains .where().orderBy(): its .where() returns the builder.
    mockTx.where.mockReturnValueOnce(mockTx);
    mockTx.where.mockResolvedValueOnce({ rowCount: 2 });

    const created = await combineWorkouts({ userId: "user-1", newWorkout: NEW_WORKOUT, deleteWorkoutIds: ["w1", "w2"] });

    expect(created.id).toBe("merged");
    expect(mockTx.values).toHaveBeenCalledWith({ ...NEW_WORKOUT, userId: "user-1" });
    expect(mockTx.delete).toHaveBeenCalledTimes(1);
    expect(mockTx.update).not.toHaveBeenCalled();
  });

  it("404s when a source workout is missing or belongs to someone else", async () => {
    mockTx.where.mockResolvedValueOnce([{ id: "w1", planDayId: null }]);

    await expect(
      combineWorkouts({ userId: "user-1", newWorkout: NEW_WORKOUT, deleteWorkoutIds: ["w1", "w2"] }),
    ).rejects.toThrowError(new AppError(ErrorCode.NOT_FOUND, "One or more source workouts not found", 404));
    expect(mockTx.insert).not.toHaveBeenCalled();
    expect(mockTx.delete).not.toHaveBeenCalled();
  });

  it("404s when the kept plan day is not the caller's", async () => {
    mockTx.where.mockResolvedValueOnce([{ id: "w1", planDayId: null }]);
    // Ownership check goes through .limit(1), not .where(), as its terminal call.
    mockTx.where.mockReturnValueOnce(mockTx);
    mockTx.limit.mockResolvedValueOnce([]);

    await expect(
      combineWorkouts({ userId: "user-1", newWorkout: { ...NEW_WORKOUT, planDayId: "pd-other" }, deleteWorkoutIds: ["w1"] }),
    ).rejects.toThrowError(new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404));
    expect(mockTx.insert).not.toHaveBeenCalled();
  });

  it("refuses to combine a source linked to a plan day that is neither kept nor skipped", async () => {
    mockTx.where.mockResolvedValueOnce([{ id: "w1", planDayId: "pd-linked" }, { id: "w2", planDayId: null }]);

    await expect(
      combineWorkouts({ userId: "user-1", newWorkout: NEW_WORKOUT, deleteWorkoutIds: ["w1", "w2"] }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, status: 400 });
    expect(mockTx.insert).not.toHaveBeenCalled();
    expect(mockTx.delete).not.toHaveBeenCalled();
  });

  it("keeps a source's plan day when the merged log takes it over", async () => {
    mockTx.where.mockResolvedValueOnce([{ id: "w1", planDayId: "pd-kept" }]);
    // The ownership check chains .where().limit(): its .where() must return the builder.
    mockTx.where.mockReturnValueOnce(mockTx);
    mockTx.limit.mockResolvedValueOnce([{ id: "pd-kept" }]);
    // Set re-parent lookup chains .where().orderBy(): its .where() returns the builder.
    mockTx.where.mockReturnValueOnce(mockTx);
    mockTx.where.mockResolvedValueOnce({ rowCount: 1 });

    const created = await combineWorkouts({
      userId: "user-1",
      newWorkout: { ...NEW_WORKOUT, planDayId: "pd-kept" },
      deleteWorkoutIds: ["w1"],
    });

    expect(created.id).toBe("merged");
    expect(mockTx.values).toHaveBeenCalledWith({ ...NEW_WORKOUT, planDayId: "pd-kept", userId: "user-1" });
    // Nothing to skip: the kept day is never marked skipped even if listed.
    expect(mockTx.update).not.toHaveBeenCalled();
  });

  it("moves the sources' logged sets onto the merged log before deleting them", async () => {
    mockTx.where.mockResolvedValueOnce([{ id: "w1", planDayId: null }, { id: "w2", planDayId: null }]);
    // Set re-parent lookup chains .where().orderBy(): its .where() returns the builder.
    mockTx.where.mockReturnValueOnce(mockTx);
    mockTx.orderBy.mockResolvedValueOnce([
      { id: "s1", exerciseName: "Squat" },
      { id: "s2", exerciseName: "Squat" },
      { id: "s3", exerciseName: "Bench" },
    ]);
    mockTx.where.mockResolvedValueOnce({ rowCount: 3 }); // set re-parent update
    mockTx.where.mockResolvedValueOnce({ rowCount: 2 }); // source delete

    await combineWorkouts({ userId: "user-1", newWorkout: NEW_WORKOUT, deleteWorkoutIds: ["w1", "w2"] });

    // The sets are re-owned by the merged log rather than left to cascade.
    expect(mockTx.update).toHaveBeenCalledTimes(1);
    const setArg = mockTx.set.mock.calls[0]?.[0] as { workoutLogId: string };
    expect(setArg.workoutLogId).toBe("merged");

    // Ordering is what saves them: the cascade must find nothing left.
    const updateOrder = mockTx.update.mock.invocationCallOrder[0];
    const deleteOrder = mockTx.delete.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(deleteOrder);
  });

  it("leaves the sources alone when they carry no logged sets", async () => {
    mockTx.where.mockResolvedValueOnce([{ id: "w1", planDayId: null }]);
    mockTx.where.mockReturnValueOnce(mockTx);
    mockTx.orderBy.mockResolvedValueOnce([]);
    mockTx.where.mockResolvedValueOnce({ rowCount: 1 }); // source delete

    await combineWorkouts({ userId: "user-1", newWorkout: NEW_WORKOUT, deleteWorkoutIds: ["w1"] });

    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockTx.delete).toHaveBeenCalledTimes(1);
  });

  it("marks the skipped plan days after deleting the sources, never the kept one", async () => {
    mockTx.where.mockResolvedValueOnce([{ id: "w1", planDayId: "pd-skip" }, { id: "w2", planDayId: "pd-kept" }]);
    mockTx.where.mockReturnValueOnce(mockTx);
    mockTx.limit.mockResolvedValueOnce([{ id: "pd-kept" }]);
    // Set re-parent lookup chains .where().orderBy(): its .where() returns the builder.
    mockTx.where.mockReturnValueOnce(mockTx);
    mockTx.where.mockResolvedValueOnce({ rowCount: 2 }); // source delete
    mockTx.where.mockResolvedValueOnce({ rowCount: 1 }); // skip update

    await combineWorkouts({
      userId: "user-1",
      newWorkout: { ...NEW_WORKOUT, planDayId: "pd-kept" },
      deleteWorkoutIds: ["w1", "w2"],
      skipPlanDayIds: ["pd-skip", "pd-kept"],
    });

    expect(mockTx.update).toHaveBeenCalledTimes(1);
    expect(mockTx.set).toHaveBeenCalledWith({ status: "skipped" });
    const deleteOrder = mockTx.delete.mock.invocationCallOrder[0];
    const updateOrder = mockTx.update.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(updateOrder);
  });
});
