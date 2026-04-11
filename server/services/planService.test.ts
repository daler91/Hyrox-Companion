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
      updatePlanDay: vi.fn(),
    },
    workouts: {
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

    const setupMockTransaction = (linkedLogs: Record<string, unknown>[], dayExistenceResult: Record<string, unknown>[], expectedResult: Record<string, unknown>[]) => {
      const mockTx = {
        select: vi.fn(),
        delete: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(expectedResult),
      };

      mockTx.select = vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValue(linkedLogs),
            })
          })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            innerJoin: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockResolvedValue(dayExistenceResult)
            })
          })
        });

      vi.mocked(db.transaction).mockImplementation(async (callback) => {
        return await callback(mockTx as unknown as Parameters<Parameters<typeof db.transaction>[0]>[0]);
      });

      return mockTx;
    };

    it("should call storage.plans.updatePlanDay when mainWorkout is not updated", async () => {
      const updates = { focus: "New Focus" };
      const expectedResult = createMockPlanDay({ id: dayId, focus: "New Focus" });

      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue(expectedResult);

      const result = await updatePlanDayWithCleanup(dayId, updates, userId);

      expect(storage.plans.updatePlanDay).toHaveBeenCalledTimes(1);
      expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(dayId, updates, userId);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(result).toEqual(expectedResult);
    });

    it("should handle mainWorkout update when no linked log exists", async () => {
      const updates = { mainWorkout: "New Workout" };
      const expectedResult = { id: dayId, mainWorkout: "New Workout" };

      const mockTx = setupMockTransaction([], [{ planDay: { id: dayId } }], [expectedResult]);

      const result = await updatePlanDayWithCleanup(dayId, updates, userId);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.delete).not.toHaveBeenCalled();
      expect(mockTx.update).toHaveBeenCalledWith(planDays);
      expect(result).toEqual(expectedResult);
    });

    it("should delete exercise sets when mainWorkout is updated and linked log exists", async () => {
      const updates = { mainWorkout: "New Workout" };
      const expectedResult = { id: dayId, mainWorkout: "New Workout" };
      const mockLinkedLog = { id: "log-id" };

      const mockTx = setupMockTransaction([mockLinkedLog], [{ planDay: { id: dayId } }], [expectedResult]);

      const result = await updatePlanDayWithCleanup(dayId, updates, userId);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.delete).toHaveBeenCalledWith(exerciseSets);
      expect(mockTx.update).toHaveBeenCalledWith(planDays);
      expect(result).toEqual(expectedResult);
    });

    it("should return undefined if planDay does not exist or does not belong to user", async () => {
      const updates = { mainWorkout: "New Workout" };

      const mockTx = setupMockTransaction([], [], []);

      const result = await updatePlanDayWithCleanup(dayId, updates, userId);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.update).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });
  });

  describe("updatePlanDayStatus", () => {
    const dayId = "test-day-id";
    const userId = "test-user-id";

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should delete the linked workout log when switching away from completed", async () => {
      // The write-through in workoutService.updateWorkout / createWorkoutInTx
      // already keeps the plan day's content in sync with the log, so on
      // revert we only need to delete the log. The plan day update itself
      // should only carry the status change.
      vi.mocked(storage.workouts.deleteWorkoutLogByPlanDayId).mockResolvedValue(true);
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue(
        createMockPlanDay({ id: dayId, status: "planned" }),
      );

      await updatePlanDayStatus(dayId, { status: "planned" }, userId);

      expect(storage.workouts.deleteWorkoutLogByPlanDayId).toHaveBeenCalledWith(dayId, userId);
      expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
        dayId,
        { status: "planned" },
        userId,
      );
    });

    it("should also delete the log when switching to skipped or missed", async () => {
      vi.mocked(storage.workouts.deleteWorkoutLogByPlanDayId).mockResolvedValue(true);
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue(
        createMockPlanDay({ id: dayId, status: "skipped" }),
      );

      await updatePlanDayStatus(dayId, { status: "skipped" }, userId);

      expect(storage.workouts.deleteWorkoutLogByPlanDayId).toHaveBeenCalledWith(dayId, userId);
    });

    it("should not touch workout logs when switching to completed", async () => {
      vi.mocked(storage.plans.updatePlanDay).mockResolvedValue(
        createMockPlanDay({ id: dayId, status: "completed" }),
      );

      await updatePlanDayStatus(dayId, { status: "completed" }, userId);

      expect(storage.workouts.deleteWorkoutLogByPlanDayId).not.toHaveBeenCalled();
      expect(storage.plans.updatePlanDay).toHaveBeenCalledWith(
        dayId,
        { status: "completed" },
        userId,
      );
    });
  });
});
