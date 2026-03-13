import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateWorkout } from "./workoutService";
import { db } from "../db";
import { storage } from "../storage";
import { workoutLogs, exerciseSets, customExercises } from "@shared/schema";

vi.mock("../db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock("../storage", () => ({
  storage: {
    updateWorkoutLog: vi.fn(),
  },
}));

describe("updateWorkout", () => {
  let mockTx: any;
  let selectWhereMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    selectWhereMock = vi.fn().mockResolvedValue([{ id: "w1", userId: "u1" }]);

    mockTx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: selectWhereMock,
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "w1", userId: "u1", date: "2026-01-01" }]),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
    };

    (db.transaction as any).mockImplementation(async (cb: any) => {
      return await cb(mockTx);
    });
  });

  it("should update workout and sets when exercises are provided", async () => {
    const updateData = { date: "2026-01-02" };
    const exercises = [
      { exerciseName: "squat", numSets: 3, reps: 5, weight: 100 },
      { exerciseName: "custom", customLabel: "My Custom Lift", category: "strength", numSets: 1 },
      { exerciseName: "custom", customLabel: "My Custom Lift", category: "strength", numSets: 1 }, // duplicate
    ];

    const setsReturningMock = vi.fn().mockResolvedValue([{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }, { id: "s5" }]);
    mockTx.insert.mockImplementation((table: any) => {
      if (table === exerciseSets) {
         return { values: vi.fn().mockReturnValue({ returning: setsReturningMock }) };
      }
      if (table === customExercises) {
         return { values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue([]) }) };
      }
      return { values: vi.fn() };
    });

    const result = await updateWorkout("w1", updateData, exercises, "u1");

    expect(result).toBeDefined();
    expect(result?.id).toBe("w1");
    expect(result?.exerciseSets).toHaveLength(5); // 3 squats + 2 custom

    expect(db.transaction).toHaveBeenCalled();
    expect(mockTx.select).toHaveBeenCalled();
    expect(mockTx.update).toHaveBeenCalled();
    expect(mockTx.delete).toHaveBeenCalled();
    expect(mockTx.insert).toHaveBeenCalledTimes(2); // One for sets, one for custom exercises
  });

  it("should fallback to storage when exercises are undefined", async () => {
    const updateData = { date: "2026-01-02" };
    const expectedLog = { id: "w1", date: "2026-01-02", userId: "u1" };
    (storage.updateWorkoutLog as any).mockResolvedValue(expectedLog);

    const result = await updateWorkout("w1", updateData, undefined, "u1");

    expect(result).toEqual(expectedLog);
    expect(storage.updateWorkoutLog).toHaveBeenCalledWith("w1", updateData, "u1");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("should return null if workout is not found during transaction", async () => {
    selectWhereMock.mockResolvedValueOnce([]); // select returns empty array

    const result = await updateWorkout("w1", {}, [], "u1");

    expect(result).toBeNull();
    expect(mockTx.update).not.toHaveBeenCalled();
  });

  it("should delete existing sets and insert nothing if exercises array is empty", async () => {
    const result = await updateWorkout("w1", { date: "2026-01-02" }, [], "u1");

    expect(result).toEqual({ id: "w1", userId: "u1", date: "2026-01-01" });
    expect(mockTx.delete).toHaveBeenCalled();
    expect(mockTx.insert).not.toHaveBeenCalled();
  });
});
