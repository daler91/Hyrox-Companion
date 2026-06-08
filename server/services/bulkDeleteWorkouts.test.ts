import { beforeEach,describe, expect, it, vi } from "vitest";

import { db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { syncPlanDayStatusFromWorkouts } from "../storage/planDayStatus";
import {
  BULK_DELETE_WORKOUTS_NOT_FOUND,
  bulkDeleteWorkouts,
  isBulkDeleteWorkoutsNotFoundError} from "./bulkDeleteWorkouts";

// Mock dependencies
vi.mock("../db", () => {
  return {
    db: {
      transaction: vi.fn(),
    },
  };
});

vi.mock("../storage/planDayStatus", () => ({
  syncPlanDayStatusFromWorkouts: vi.fn(),
}));

describe("bulkDeleteWorkouts", () => {
  let mockTx: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    };

    vi.mocked(db.transaction).mockImplementation(async (callback) => {
      return await callback(mockTx);
    });
  });

  describe("isBulkDeleteWorkoutsNotFoundError", () => {
    it("returns true for NOT_FOUND AppError", () => {
      const error = new AppError(ErrorCode.NOT_FOUND, "Not found", 404);
      expect(isBulkDeleteWorkoutsNotFoundError(error)).toBe(true);
    });

    it("returns false for other AppErrors", () => {
      const error = new AppError(ErrorCode.VALIDATION_ERROR, "Invalid", 400);
      expect(isBulkDeleteWorkoutsNotFoundError(error)).toBe(false);
    });

    it("returns false for generic Errors", () => {
      const error = new Error("Something went wrong");
      expect(isBulkDeleteWorkoutsNotFoundError(error)).toBe(false);
    });
  });

  describe("bulkDeleteWorkouts", () => {
    const userId = "user1";

    it("returns empty result when no IDs provided", async () => {
      const result = await bulkDeleteWorkouts({ userId, workoutLogIds: [], planDayIds: [] });

      expect(result).toEqual({
        success: true,
        deletedWorkoutLogIds: [],
        deletedPlanDayIds: [],
        deletedCount: 0,
      });

      expect(mockTx.select).not.toHaveBeenCalled();
      expect(mockTx.delete).not.toHaveBeenCalled();
    });

    it("successfully deletes workouts and syncs plan day status", async () => {
      const workoutLogIds = ["w1", "w2"];
      const sourceWorkouts = [
        { id: "w1", planDayId: "pd1" },
        { id: "w2", planDayId: "pd2" }
      ];

      mockTx.where.mockResolvedValueOnce(sourceWorkouts);
      mockTx.where.mockResolvedValueOnce({ rowCount: 2 });

      const result = await bulkDeleteWorkouts({ userId, workoutLogIds, planDayIds: [] });

      expect(result).toEqual({
        success: true,
        deletedWorkoutLogIds: ["w1", "w2"],
        deletedPlanDayIds: [],
        deletedCount: 2,
      });

      expect(syncPlanDayStatusFromWorkouts).toHaveBeenCalledTimes(2);
      expect(syncPlanDayStatusFromWorkouts).toHaveBeenCalledWith("pd1", userId, mockTx);
      expect(syncPlanDayStatusFromWorkouts).toHaveBeenCalledWith("pd2", userId, mockTx);
    });

    it("throws AppError if source workouts count mismatch", async () => {
      const workoutLogIds = ["w1", "w2"];
      const sourceWorkouts = [
        { id: "w1", planDayId: "pd1" }
      ];

      mockTx.where.mockResolvedValueOnce(sourceWorkouts);

      await expect(bulkDeleteWorkouts({ userId, workoutLogIds, planDayIds: [] }))
        .rejects.toThrowError(new AppError(ErrorCode.NOT_FOUND, BULK_DELETE_WORKOUTS_NOT_FOUND, 404));
    });

    it("throws AppError if workout deletion row count mismatch", async () => {
      const workoutLogIds = ["w1", "w2"];
      const sourceWorkouts = [
        { id: "w1", planDayId: "pd1" },
        { id: "w2", planDayId: "pd2" }
      ];

      mockTx.where.mockResolvedValueOnce(sourceWorkouts);
      mockTx.where.mockResolvedValueOnce({ rowCount: 1 });

      await expect(bulkDeleteWorkouts({ userId, workoutLogIds, planDayIds: [] }))
        .rejects.toThrowError(new AppError(ErrorCode.NOT_FOUND, BULK_DELETE_WORKOUTS_NOT_FOUND, 404));
    });

    it("successfully deletes plan days", async () => {
      const planDayIds = ["pd1", "pd2"];
      const ownedPlanDays = [
        { id: "pd1" },
        { id: "pd2" }
      ];

      // First is the select query for ownedPlanDays
      mockTx.where.mockResolvedValueOnce(ownedPlanDays);

      // Then is the userPlanIds select builder inside `if (planDayIds.length)` block:
      // const userPlanIds = tx.select({...}).from(...).where(...);
      // Wait, `userPlanIds` is not awaited, it's just a query builder.
      // But it calls `.where(...)` synchronously.
      // So `.where()` is called once more and returns a mock object, not a promise.
      // Then `const deleted = await tx.delete(...).where(...)`
      // So the `.where(...)` on `tx.delete()` needs to resolve to `{ rowCount: 2 }`.
      // We can use mockImplementation to handle both cases.
      mockTx.where.mockImplementation((arg: any) => {
        // We're returning promises to simulate async DB calls
        return Promise.resolve({ rowCount: 2 });
      });

      // Let's properly orchestrate `mockTx.where` returns
      mockTx.where
        .mockReset()
        .mockResolvedValueOnce(ownedPlanDays) // await ownedPlanDays query
        .mockReturnValueOnce(mockTx)          // sync userPlanIds builder
        .mockResolvedValueOnce({ rowCount: 2 }); // await deleted query

      const result = await bulkDeleteWorkouts({ userId, workoutLogIds: [], planDayIds });

      expect(result).toEqual({
        success: true,
        deletedWorkoutLogIds: [],
        deletedPlanDayIds: ["pd1", "pd2"],
        deletedCount: 2,
      });
    });

    it("throws AppError if owned plan days count mismatch", async () => {
      const planDayIds = ["pd1", "pd2"];
      const ownedPlanDays = [
        { id: "pd1" }
      ];

      mockTx.where.mockResolvedValueOnce(ownedPlanDays);

      await expect(bulkDeleteWorkouts({ userId, workoutLogIds: [], planDayIds }))
        .rejects.toThrowError(new AppError(ErrorCode.NOT_FOUND, BULK_DELETE_WORKOUTS_NOT_FOUND, 404));
    });

    it("throws AppError if plan day deletion row count mismatch", async () => {
      const planDayIds = ["pd1", "pd2"];
      const ownedPlanDays = [
        { id: "pd1" },
        { id: "pd2" }
      ];

      mockTx.where
        .mockReset()
        .mockResolvedValueOnce(ownedPlanDays) // await ownedPlanDays query
        .mockReturnValueOnce(mockTx)          // sync userPlanIds builder
        .mockResolvedValueOnce({ rowCount: 1 }); // await deleted query

      await expect(bulkDeleteWorkouts({ userId, workoutLogIds: [], planDayIds }))
        .rejects.toThrowError(new AppError(ErrorCode.NOT_FOUND, BULK_DELETE_WORKOUTS_NOT_FOUND, 404));
    });

    it("successfully deletes both workouts and plan days", async () => {
      const workoutLogIds = ["w1"];
      const sourceWorkouts = [{ id: "w1", planDayId: "pd1" }];
      const planDayIds = ["pd2"];
      const ownedPlanDays = [{ id: "pd2" }];

      mockTx.where
        .mockReset()
        .mockResolvedValueOnce(sourceWorkouts) // await sourceWorkouts query
        .mockResolvedValueOnce(ownedPlanDays)  // await ownedPlanDays query
        .mockResolvedValueOnce({ rowCount: 1 }) // await workouts deleted query
        .mockReturnValueOnce(mockTx)           // sync userPlanIds builder
        .mockResolvedValueOnce({ rowCount: 1 }); // await planDays deleted query

      const result = await bulkDeleteWorkouts({ userId, workoutLogIds, planDayIds });
      expect(result).toEqual({
        success: true,
        deletedWorkoutLogIds: ["w1"],
        deletedPlanDayIds: ["pd2"],
        deletedCount: 2,
      });
      expect(syncPlanDayStatusFromWorkouts).toHaveBeenCalledTimes(1);
    });
  });
});
