import { describe, it, expect, vi, beforeEach } from "vitest";
import { importPlanFromCSV, validateAndMapCSVRows, createSamplePlan, updatePlanDayWithCleanup } from "./planService";
import { db } from "../db";

import { exerciseSets, planDays } from "@shared/schema";
import { storage } from "../storage";
import { samplePlanDays } from "../samplePlan";
import * as csvParse from "csv-parse/sync";

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
      createTrainingPlan: vi.fn(),
      createPlanDays: vi.fn(),
      getTrainingPlan: vi.fn(),
      updatePlanDay: vi.fn(),
    },
  };
});

describe("planService", () => {
  describe("importPlanFromCSV", () => {
    let consoleErrorSpy: any;

    beforeEach(() => {
      vi.clearAllMocks();
      // Suppress console.error in tests but keep track of calls
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
      expect(consoleErrorSpy).toHaveBeenCalledWith("CSV parse error:", mockError);
    });
  });

  describe("createSamplePlan", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should create a sample plan and its days correctly", async () => {
      const userId = "test-user-id";
      const mockPlanId = "mock-plan-id";
      const mockFullPlan = { id: mockPlanId, name: "8-Week Hyrox Training Plan", userId, days: [] };

      // Mock the storage functions
      vi.mocked(storage.createTrainingPlan).mockResolvedValue({
        id: mockPlanId,
        userId,
        name: "8-Week Hyrox Training Plan",
        sourceFileName: null,
        totalWeeks: 8,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      vi.mocked(storage.createPlanDays).mockResolvedValue(undefined as any);
      vi.mocked(storage.getTrainingPlan).mockResolvedValue(mockFullPlan as any);

      const result = await createSamplePlan(userId);

      // Verify createTrainingPlan was called with correct parameters
      expect(storage.createTrainingPlan).toHaveBeenCalledTimes(1);
      expect(storage.createTrainingPlan).toHaveBeenCalledWith({
        userId,
        name: "8-Week Hyrox Training Plan",
        sourceFileName: null,
        totalWeeks: 8,
      });

      // Verify createPlanDays was called with correct parameters
      expect(storage.createPlanDays).toHaveBeenCalledTimes(1);

      const expectedDays = samplePlanDays.map((d) => ({
        planId: mockPlanId,
        weekNumber: d.week,
        dayName: d.day,
        focus: d.focus,
        mainWorkout: d.main,
        accessory: d.accessory,
        notes: d.notes,
      }));

      expect(storage.createPlanDays).toHaveBeenCalledWith(expectedDays);

      // Verify getTrainingPlan was called
      expect(storage.getTrainingPlan).toHaveBeenCalledTimes(1);
      expect(storage.getTrainingPlan).toHaveBeenCalledWith(mockPlanId, userId);

      // Verify the returned result
      expect(result).toEqual(mockFullPlan);
    });
  });

  describe("validateAndMapCSVRows", () => {
    it("should return an empty array if records is not an array", () => {
      expect(validateAndMapCSVRows(null as any)).toEqual([]);
      expect(validateAndMapCSVRows(undefined as any)).toEqual([]);
      expect(validateAndMapCSVRows("not an array" as any)).toEqual([]);
      expect(validateAndMapCSVRows({} as any)).toEqual([]);
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
        Day: "[object Object]",
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

    const setupMockTransaction = (linkedLogs: any[], dayExistenceResult: any[], expectedResult: any[]) => {
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
        return await callback(mockTx as any);
      });

      return mockTx;
    };

    it("should call storage.updatePlanDay when mainWorkout is not updated", async () => {
      const updates = { focus: "New Focus" };
      const expectedResult = { id: dayId, focus: "New Focus" };

      vi.mocked(storage.updatePlanDay).mockResolvedValue(expectedResult as any);

      const result = await updatePlanDayWithCleanup(dayId, updates, userId);

      expect(storage.updatePlanDay).toHaveBeenCalledTimes(1);
      expect(storage.updatePlanDay).toHaveBeenCalledWith(dayId, updates, userId);
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
});
