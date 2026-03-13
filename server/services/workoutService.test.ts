import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWorkout } from "./workoutService";
import { db } from "../db";
import { storage } from "../storage";
import { workoutLogs, planDays, exerciseSets, customExercises } from "@shared/schema";
import { eq } from "drizzle-orm";

vi.mock("../db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock("../storage", () => ({
  storage: {
    createWorkoutLog: vi.fn(),
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn((col, val) => ({ col, val })),
    and: vi.fn((...args) => args),
  };
});

describe("createWorkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const userId = "user123";
  const baseWorkoutData = {
    date: "2026-01-15",
    type: "strength",
  };

  it("should use storage.createWorkoutLog when exercises array is undefined", async () => {
    const expectedLog = { id: "log1", ...baseWorkoutData, userId };
    vi.mocked(storage.createWorkoutLog).mockResolvedValue(expectedLog as any);

    const result = await createWorkout(baseWorkoutData as any, undefined, userId);

    expect(storage.createWorkoutLog).toHaveBeenCalledWith({ ...baseWorkoutData, userId });
    expect(result).toEqual(expectedLog);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("should use storage.createWorkoutLog when exercises array is empty", async () => {
    const expectedLog = { id: "log1", ...baseWorkoutData, userId };
    vi.mocked(storage.createWorkoutLog).mockResolvedValue(expectedLog as any);

    const result = await createWorkout(baseWorkoutData as any, [], userId);

    expect(storage.createWorkoutLog).toHaveBeenCalledWith({ ...baseWorkoutData, userId });
    expect(result).toEqual(expectedLog);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  describe("with exercises (transaction mode)", () => {
    it("should insert workout log and exercise sets", async () => {
      const logRow = { id: "log1", ...baseWorkoutData, userId };
      const savedSets = [{ id: "set1", workoutLogId: "log1", exerciseName: "squat" }];

      // Mock the tx object chain
      const tx = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
      };

      // tx.insert(workoutLogs).values().returning() -> [logRow]
      tx.returning.mockResolvedValueOnce([logRow]);
      // tx.insert(exerciseSets).values().returning() -> savedSets
      tx.returning.mockResolvedValueOnce(savedSets);

      vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
        return cb(tx);
      });

      const exercises = [
        {
          exerciseName: "squat",
          category: "strength",
          sets: [{ setNumber: 1, reps: 5, weight: 100 }],
        },
      ];

      const result = await createWorkout(baseWorkoutData as any, exercises, userId);

      expect(db.transaction).toHaveBeenCalled();

      // Verify log insertion
      expect(tx.insert).toHaveBeenCalledWith(workoutLogs);
      expect(tx.values).toHaveBeenCalledWith({ ...baseWorkoutData, userId });

      // Verify exercise sets insertion
      expect(tx.insert).toHaveBeenCalledWith(exerciseSets);
      // expect(tx.values).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ workoutLogId: "log1" })]));

      expect(result).toEqual({ ...logRow, exerciseSets: savedSets });
    });

    it("should update planDays if planDayId is provided", async () => {
      const logRow = { id: "log1", ...baseWorkoutData, planDayId: "pd1", userId };
      const tx = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      };

      tx.returning.mockResolvedValueOnce([logRow]);
      tx.returning.mockResolvedValueOnce([]); // empty sets

      vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
        return cb(tx);
      });

      const workoutData = { ...baseWorkoutData, planDayId: "pd1" };
      const exercises = [
        { exerciseName: "squat", category: "strength", numSets: 1 }
      ];

      await createWorkout(workoutData as any, exercises, userId);

      expect(tx.update).toHaveBeenCalledWith(planDays);
      expect(tx.set).toHaveBeenCalledWith({ status: "completed" });
      expect(tx.where).toHaveBeenCalledWith(eq(planDays.id, "pd1"));
    });

    it("should insert unique custom exercises", async () => {
      const logRow = { id: "log1", ...baseWorkoutData, userId };
      const tx = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
      };

      tx.returning.mockResolvedValueOnce([logRow]);
      tx.returning.mockResolvedValueOnce([]); // empty sets

      vi.mocked(db.transaction).mockImplementation(async (cb: any) => {
        return cb(tx);
      });

      const exercises = [
        { exerciseName: "custom", customLabel: "Burpee", category: "conditioning", numSets: 1 },
        { exerciseName: "custom", customLabel: "Burpee", category: "conditioning", numSets: 1 }, // Duplicate
        { exerciseName: "custom", customLabel: "Plank", category: "core", numSets: 1 },
      ];

      await createWorkout(baseWorkoutData as any, exercises, userId);

      // Verify custom exercises insertion
      expect(tx.insert).toHaveBeenCalledWith(customExercises);
      expect(tx.values).toHaveBeenCalledWith([
        { userId, name: "Burpee", category: "conditioning" },
        { userId, name: "Plank", category: "core" },
      ]);
      expect(tx.onConflictDoNothing).toHaveBeenCalled();
    });
  });
});
