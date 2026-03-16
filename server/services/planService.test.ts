import { describe, it, expect, vi, beforeEach } from "vitest";
import { importPlanFromCSV, validateAndMapCSVRows } from "./planService";
import * as csvParse from "csv-parse/sync";

vi.mock("csv-parse/sync", () => {
  return {
    parse: vi.fn(),
  };
});

// We'll mock the storage module to avoid interacting with the database
vi.mock("../storage", () => {
  return {
    storage: {
      createTrainingPlan: vi.fn(),
      createPlanDays: vi.fn(),
      getTrainingPlan: vi.fn(),
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
        Accessory: "", // false || '' evaluates to '', String('') is ''
        Notes: "" // [] is truthy, so [] || '' -> [], String([]) -> ''
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
});
