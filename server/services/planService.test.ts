import { describe, it, expect, vi, beforeEach } from "vitest";
import { importPlanFromCSV } from "./planService";
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
});
