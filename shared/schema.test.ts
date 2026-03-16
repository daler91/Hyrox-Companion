import { describe, it, expect } from "vitest";
import { importPlanRequestSchema } from "./schema";

describe("importPlanRequestSchema validation", () => {
  it("rejects a very large csvContent", () => {
    const largeCsvContent = "a".repeat(1000001); // Over 1,000,000 characters
    const payload = {
      csvContent: largeCsvContent,
      fileName: "test.csv",
      planName: "Test Plan",
    };

    const result = importPlanRequestSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toBe("CSV content must be 1,000,000 characters or less");
    }
  });

  it("rejects a very large fileName and planName", () => {
    const largeString = "a".repeat(256);
    const payload = {
      csvContent: "Week,Day,Focus,Main Workout,Accessory,Notes\n1,Monday,Focus,Workout,Accessory,Notes",
      fileName: largeString,
      planName: largeString,
    };

    const result = importPlanRequestSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors.fileName).toContain("File name must be 255 characters or less");
      expect(fieldErrors.planName).toContain("Plan name must be 255 characters or less");
    }
  });

  it("accepts valid inputs within limits", () => {
    const payload = {
      csvContent: "Week,Day,Focus,Main Workout,Accessory,Notes\n1,Monday,Focus,Workout,Accessory,Notes",
      fileName: "valid.csv",
      planName: "Valid Plan",
    };

    const result = importPlanRequestSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});
