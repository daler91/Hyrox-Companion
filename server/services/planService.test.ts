import type { PlanDay } from "@shared/schema";
import { exerciseSets, planDays } from "@shared/schema";
import * as csvParse from "csv-parse/sync";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { createMockPlanDay,createMockTrainingPlan, createMockTrainingPlanWithDays } from "../../test/factories";
import { db } from "../db";
import { logger } from "../logger";
import { samplePlanDays } from "../samplePlan";
import { storage } from "../storage";
import { createSamplePlan, importPlanFromCSV, updatePlanDayStatus, updatePlanDayWithCleanup,validateAndMapCSVRows } from "./planService";

vi.mock("csv-parse/sync", () => {
  return {
    parse: vi.fn(),
  };
});

vi.mock("../db", () => {
  return {
    db: {
      transaction: vi.fn(),
    },
  };
});

// We'll mock the storage module to avoid interacting with the database
vi.mock("../storage", () => {
  return {
    storage: {
    plans: {
      createTrainingPlan: vi.fn(),
      createPlanDays: vi.fn(),
      getTrainingPlan: vi.fn(),
      getPlanDay: vi.fn(),
      updatePlanDay: vi.fn(),
      deleteTrainingPlan: vi.fn(),
    },
    workouts: {
      getWorkoutLogByPlanDayId: vi.fn(),
      deleteWorkoutLogByPlanDayId: vi.fn(),
    },
  },
  };
});

vi.mock("../queue", () => {
  return {
    queue: {
      send: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("planService", () => {
  describe("importPlanFromCSV", () => {
    let loggerErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.clearAllMocks();
      // Suppress logger.error in tests but keep track of calls
      loggerErrorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    });

    it("should catch and log CSV parse errors, resulting in an empty rows error", async () => {
      const mockError = new Error("Mock CSV Parse Error");
      vi.mocked(csvParse.parse).mockImplementation(() => {
        throw mockError;
      });

      const invalidCSV = "invalid,csv,data";
      const userId = "test-user-id";

      await expect(importPlanFromCSV(invalidCSV, userId)).rejects.toThrow("No valid rows found in CSV");

      expect(csvParse.parse).toHaveBeenCalledWith(invalidCSV, expect.any(Object));
      expect(loggerErrorSpy).toHaveBeenCalledWith({ err: mockError }, "CSV parse error:");
    });

    it("rejects CSVs containing unrecognized day names before touching the database", async () => {
      vi.mocked(csvParse.parse).mockReturnValue([
        { Week: "1", Day: "Mondy", Focus: "Strength", "Main Workout": "Squats" },
      ]);

      await expect(importPlanFromCSV("x", "u1")).rejects.toThrow(
        /unrecognized Day values.*Mondy/i,
      );

      expect(storage.plans.createTrainingPlan).not.toHaveBeenCalled();
      expect(storage.plans.createPlanDays).not.toHaveBeenCalled();
    });

    it("rejects CSVs whose week span exceeds the 52-week cap before touching the database", async () => {
      vi.mocked(csvParse.parse).mockReturnValue([
        { Week: "1", Day: "Monday", Focus: "F", "Main Workout": "W" },
        { Week: "2024", Day: "Monday", Focus: "F", "Main Workout": "W" },
      ]);

      await expect(importPlanFromCSV("x", "u1")).rejects.toThrow(
        /exceeds the 52-week maximum/i,
      );

      expect(storage.plans.createTrainingPlan).not.toHaveBeenCalled();
    });

    it("canonicalizes mixed-case day names to title case on import", async () => {
      vi.mocked(csvParse.parse).mockReturnValue([
        { Week: "1", Day: "monday", Focus: "F", "Main Workout": "W" },
        { Week: "1", Day: "TUESDAY", Focus: "F", "Main Workout": "W" },
      ]);
      vi.mocked(storage.plans.createTrainingPlan).mockResolvedValue(
        createMockTrainingPlan({ id: "plan-1", userId: "u1" }),
      );
      vi.mocked(storage.plans.createPlanDays).mockResolvedValue([] as PlanDay[]);
      vi.mocked(storage.plans.getTrainingPlan).mockResolvedValue(
        createMockTrainingPlanWithDays({ id: "plan-1", userId: "u1" }),
      );

      await importPlanFromCSV("x", "u1");

      const call = vi.mocked(storage.plans.createPlanDays).mock.calls[0][0];
      expect(call.map((d) => d.dayName)).toEqual(["Monday", "Tuesday"]);
    });
  });

  describe("createSamplePlan", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should create a sample plan and its days correctly", async () => {
      const userId = "test-user-id";
      const mockPlanId = "mock-plan-id";
      const mockFullPlan = createMockTrainingPlanWithDays({
        id: mockPlanId,
        userId,
        name: "8-Week Functional Fitness Plan",
      });

      // Mock the storage functions
      vi.mocked(storage.plans.createTrainingPlan).mockResolvedValue(createMockTrainingPlan({
        id: mockPlanId,
        userId,
        name: "8-Week Functional Fitness Plan",
        sourceFileName: null,
        totalWeeks: 8,
      }));

      vi.mocked(storage.plans.createPlanDays).mockResolvedValue([] as PlanDay[]);
      vi.mocked(storage.plans.getTrainingPlan).mockResolvedValue(mockFullPlan);

      const result = await createSamplePlan(userId);

      // Verify createTrainingPlan was called with correct parameters
      expect(storage.plans.createTrainingPlan).toHaveBeenCalledTimes(1);
      expect(storage.plans.createTrainingPlan).toHaveBeenCalledWith({
        userId,
        name: "8-Week Functional Fitness Plan",
        sourceFileName: null,
        totalWeeks: 8,
      });

      // Verify createPlanDays was called with correct parameters
      expect(storage.plans.createPlanDays).toHaveBeenCalledTimes(1);

      const expectedDays = samplePlanDays.map((d) => ({
        planId: mockPlanId,
        weekNumber: d.week,
        dayName: d.day,
        focus: d.focus,
        mainWorkout: d.main,
        accessory: d.accessory,
        notes: d.notes,
        status: "planned",
      }));

      expect(storage.plans.createPlanDays).toHaveBeenCalledWith(expectedDays);

      // Verify getTrainingPlan was called
      expect(storage.plans.getTrainingPlan).toHaveBeenCalledTimes(1);
      expect(storage.plans.getTrainingPlan).toHaveBeenCalledWith(mockPlanId, userId);

      // Verify the returned result
      expect(result).toEqual(mockFullPlan);
    });
  });

  describe("validateAndMapCSVRows", () => {
    it("should return an empty array if records is not an array", () => {
      expect(validateAndMapCSVRows(null as unknown as unknown[])).toEqual([]);
      expect(validateAndMapCSVRows(undefined as unknown as unknown[])).toEqual([]);
      expect(validateAndMapCSVRows("not an array" as unknown as unknown[])).toEqual([]);
      expect(validateAndMapCSVRows({} as unknown as unknown[])).toEqual([]);
    });

    it("should map a complete record correctly", () => {
      const records = [{
        Week: "1",
        Day: "Monday",
        Focus: "Strength",
        "Main Workout": "Squats",
        "Accessory/Engine Work": "Lunges",
        Accessory: "Calf Raises",
        Notes: "Go heavy"
      }];

      const result = validateAndMapCSVRows(records);

      expect(result).toEqual([{
        Week: "1",
        Day: "Monday",
        Focus: "Strength",
        "Main Workout": "Squats",
        "Accessory/Engine Work": "Lunges",
        Accessory: "Calf Raises",
        Notes: "Go heavy"
      }]);
    });

    it("should handle missing properties by defaulting to empty strings", () => {
      const records = [{
        Week: "2",
        Day: "Tuesday"
        // Missing Focus, Main Workout, Accessory/Engine Work, Accessory, Notes
      }];

      const result = validateAndMapCSVRows(records);

      expect(result).toEqual([{
        Week: "2",
        Day: "Tuesday",
        Focus: "",
        "Main Workout": "",
        "Accessory/Engine Work": "",
        Accessory: "",
        Notes: ""
      }]);
    });

    it("should convert numeric or non-string values to strings", () => {
      const records = [{
        Week: 3,
        Day: { name: "Wednesday" },
        Focus: null,
        "Main Workout": undefined,
        "Accessory/Engine Work": 100,
        Accessory: false,
        Notes: []
      }];

      const result = validateAndMapCSVRows(records);

      expect(result).toEqual([{
        Week: "3",
        Day: "",
        Focus: "",
        "Main Workout": "",
        "Accessory/Engine Work": "100",
        Accessory: "",
        Notes: ""
      }]);
    });

    it("should ignore unexpected extra properties", () => {
      const records = [{
        Week: "4",
        Day: "Thursday",
        ExtraField: "Should be ignored",
        AnotherOne: 123
      }];

      const result = validateAndMapCSVRows(records);

      expect(result).toEqual([{
        Week: "4",
        Day: "Thursday",
        Focus: "",
        "Main Workout": "",
        "Accessory/Engine Work": "",
        Accessory: "",
        Notes: ""
      }]);
    });
  });

  describe("updatePlanDayWithCleanup", () => {
    const dayId = "test-day-id";
    const userId = "test-user-id";

    beforeEach(() => {
      vi.clearAllMocks();
    });

    // In the structured-exercise-first model, exercise_sets are an owned
    // entity independent of the free-text prescription. Updating mainWorkout
    // no longer cascades to delete the linked log's exercise_sets; the
    // helper now just delegates to storage.plans.updatePlanDay for every
    // field (including mainWorkout). The /reparse endpoint is the explicit
    // path when the athlete wants structured rows regenerated from text.

    it("delegates to storage.plans.updatePlanDay when only non-prescription fields change", async () => {
      const updates = { focus: "New Focus" };
      const expectedResult = createMockPlanDay({ id: dayId, focus: "New Focus" });
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue(expectedResult);

      const result = await updatePlanDayWithCleanup(dayId, updates, userId);

      expect(storage.plans.updatePlanDay).toHaveBeenCalledTimes(1);
      expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(dayId, updates, userId);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(result).toEqual(expectedResult);
    });

    it("does not delete exercise_sets when mainWorkout is updated", async () => {
      const updates = { mainWorkout: "New Workout" };
      const expectedResult = createMockPlanDay({ id: dayId, mainWorkout: "New Workout" });
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue(expectedResult);

      const result = await updatePlanDayWithCleanup(dayId, updates, userId);

      expect(storage.plans.updatePlanDay).toHaveBeenCalledTimes(1);
      expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(dayId, updates, userId);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(result).toEqual(expectedResult);
    });

    it("returns undefined when storage reports the plan day doesn't exist", async () => {
      const updates = { mainWorkout: "New Workout" };
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue(undefined);

      const result = await updatePlanDayWithCleanup(dayId, updates, userId);

      expect(storage.plans.updatePlanDay).toHaveBeenCalledTimes(1);
      expect(result).toBeUndefined();
    });
  });

  describe("updatePlanDayStatus", () => {
    const dayId = "test-day-id";
    const userId = "test-user-id";

    beforeEach(() => {
      vi.clearAllMocks();
    });

    type MockTx = {
      select: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      deleteWhere: ReturnType<typeof vi.fn>;
      updateSet: ReturnType<typeof vi.fn>;
      updateWhere: ReturnType<typeof vi.fn>;
      updateReturning: ReturnType<typeof vi.fn>;
    };

    // Wire up a tx that supports the shapes planService uses:
    //   1. select({...}).from(planDays).innerJoin(trainingPlans, ...).where(...).for("update")
    //   2. select().from(workoutLogs).where(...).limit(1)
    //   3. select().from(exerciseSets).where(...).orderBy(...)   ← copy-back
    // plus delete(workoutLogs).where(...), delete(exerciseSets).where(...),
    // insert(exerciseSets).values(...), and update(planDays).set(...).where(...).returning().
    const setupTx = (
      statusLookup: Array<{ status: string }>,
      existingLog: Array<Record<string, unknown>> = [],
      updateReturning: Array<Record<string, unknown>> = [],
      loggedSetsSnapshot: Array<Record<string, unknown>> = [],
    ): MockTx => {
      const mockTx: MockTx = {
        select: vi.fn(),
        delete: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        deleteWhere: vi.fn().mockResolvedValue(undefined),
        updateSet: vi.fn().mockReturnThis(),
        updateWhere: vi.fn().mockReturnThis(),
        updateReturning: vi.fn().mockResolvedValue(updateReturning),
      };

      mockTx.select = vi.fn()
        // first call: status lookup (with innerJoin + for("update"))
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            innerJoin: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                for: vi.fn().mockResolvedValue(statusLookup),
              }),
            }),
          }),
        })
        // second call: existing log lookup (with limit)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValue(existingLog),
            }),
          }),
        })
        // third call (only fires on completed→planned path): logged sets snapshot
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              orderBy: vi.fn().mockResolvedValue(loggedSetsSnapshot),
            }),
          }),
        });

      mockTx.delete = vi.fn().mockReturnValue({ where: mockTx.deleteWhere });
      mockTx.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning: mockTx.updateReturning }),
        }),
      });
      // Insert (used for copy-back of logged sets onto the plan day).
      (mockTx as unknown as { insert: ReturnType<typeof vi.fn> }).insert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      vi.mocked(db.transaction).mockImplementation(async (callback) =>
        callback(mockTx as unknown as Parameters<Parameters<typeof db.transaction>[0]>[0]),
      );

      return mockTx;
    };

    it("preserves workout log edits on the plan day when switching from completed to planned", async () => {
      const returned = createMockPlanDay({ id: dayId, status: "planned", focus: "Edited Focus" });
      const tx = setupTx(
        [{ status: "completed" }],
        [{ id: "log-id", focus: "Edited Focus", mainWorkout: "Edited Main Workout", accessory: "Edited Accessory", notes: "Edited Notes" }],
        [returned],
      );

      const result = await updatePlanDayStatus(dayId, { status: "planned" }, userId);

      expect(tx.deleteWhere).toHaveBeenCalled(); // workout log deleted
      expect(tx.updateReturning).toHaveBeenCalled(); // plan day updated
      expect(result).toEqual(returned);
    });

    it("updates the plan day without touching logs when transitioning between non-completed states", async () => {
      const returned = createMockPlanDay({ id: dayId, status: "planned" });
      const tx = setupTx([{ status: "missed" }], [], [returned]);

      await updatePlanDayStatus(dayId, { status: "planned" }, userId);

      expect(tx.deleteWhere).not.toHaveBeenCalled();
      expect(tx.updateReturning).toHaveBeenCalled();
    });

    it("does not touch workout logs when switching to completed", async () => {
      const returned = createMockPlanDay({ id: dayId, status: "completed" });
      const tx = setupTx([{ status: "planned" }], [], [returned]);

      await updatePlanDayStatus(dayId, { status: "completed" }, userId);

      expect(tx.deleteWhere).not.toHaveBeenCalled();
      expect(tx.updateReturning).toHaveBeenCalled();
    });

    it("rejects an invalid transition (skipped → missed)", async () => {
      const tx = setupTx([{ status: "skipped" }]);

      await expect(
        updatePlanDayStatus(dayId, { status: "missed" }, userId),
      ).rejects.toThrow(/Invalid plan-day status transition/);

      expect(tx.updateReturning).not.toHaveBeenCalled();
    });

    it("allows idempotent same-state transitions without touching workout logs", async () => {
      // R8: even when from === status === 'planned', cleanup must not fire.
      const returned = createMockPlanDay({ id: dayId, status: "planned" });
      const tx = setupTx([{ status: "planned" }], [{ id: "stray-log" }], [returned]);

      await updatePlanDayStatus(dayId, { status: "planned" }, userId);

      expect(tx.deleteWhere).not.toHaveBeenCalled();
      expect(tx.updateReturning).toHaveBeenCalled();
    });

    it("throws NOT_FOUND when plan day doesn't exist", async () => {
      setupTx([]); // empty status lookup

      await expect(
        updatePlanDayStatus(dayId, { status: "completed" }, userId),
      ).rejects.toThrow(/Plan day not found/);
    });

    it("skips transition check when only scheduledDate changes", async () => {
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue(
        createMockPlanDay({ id: dayId }),
      );

      await updatePlanDayStatus(dayId, { scheduledDate: "2026-05-01" }, userId);

      expect(db.transaction).not.toHaveBeenCalled();
      expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
        dayId,
        { scheduledDate: "2026-05-01" },
        userId,
      );
    });
  });
});
