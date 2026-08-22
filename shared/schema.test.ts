import { describe, expect,it } from "vitest";

import {
  exercisesPayloadSchema,
  generatePlanInputSchema,
  importPlanRequestSchema,
  parseExercisesFromImageRequestSchema,
  SET_TIME_MAX_MINUTES,
  updateWorkoutLogSchema,
} from "./schema";

describe("importPlanRequestSchema validation", () => {
  it("rejects a very large csvContent", () => {
    const largeCsvContent = "a".repeat(100001); // Over 1,000,000 characters
    const payload = {
      csvContent: largeCsvContent,
      fileName: "test.csv",
      planName: "Test Plan",
    };

    const result = importPlanRequestSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("CSV content must be 100,000 characters or less");
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

describe("parseExercisesFromImageRequestSchema validation", () => {
  it("accepts a small jpeg base64 payload", () => {
    const result = parseExercisesFromImageRequestSchema.safeParse({
      mimeType: "image/jpeg",
      imageBase64: "abc123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unsupported mime type (gif)", () => {
    const result = parseExercisesFromImageRequestSchema.safeParse({
      mimeType: "image/gif",
      imageBase64: "abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty image", () => {
    const result = parseExercisesFromImageRequestSchema.safeParse({
      mimeType: "image/png",
      imageBase64: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Image is required");
    }
  });

  it("rejects base64 strings larger than the 10MB cap", () => {
    const oversized = "a".repeat(10 * 1024 * 1024 + 1);
    const result = parseExercisesFromImageRequestSchema.safeParse({
      mimeType: "image/jpeg",
      imageBase64: oversized,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "Image must be 10MB or less")).toBe(
        true,
      );
    }
  });
});

describe("generatePlanInputSchema validation", () => {
  const validBase = {
    goal: "Hyrox race prep",
    daysPerWeek: 5,
    experienceLevel: "intermediate" as const,
    startDate: "2026-05-04",
    endDate: "2026-06-29", // 56-day span → 8 weeks
  };

  it("accepts a valid date range and defaults endDateIsRaceDate to true", () => {
    const result = generatePlanInputSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.endDateIsRaceDate).toBe(true);
    }
  });

  it("rejects an end date on or before the start date", () => {
    const result = generatePlanInputSchema.safeParse({
      ...validBase,
      startDate: "2026-06-29",
      endDate: "2026-05-04",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("endDate"))).toBe(true);
    }
  });

  it("rejects a span longer than 24 weeks", () => {
    const result = generatePlanInputSchema.safeParse({
      ...validBase,
      startDate: "2026-01-01",
      endDate: "2027-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("requires an end date", () => {
    const result = generatePlanInputSchema.safeParse({
      goal: "Hyrox race prep",
      daysPerWeek: 5,
      experienceLevel: "intermediate",
      startDate: "2026-05-04",
    });
    expect(result.success).toBe(false);
  });
});

describe("workout log manual distance/heart-rate bounds", () => {
  it("rejects out-of-range heart rates", () => {
    expect(updateWorkoutLogSchema.safeParse({ avgHeartrate: 300 }).success).toBe(false);
    expect(updateWorkoutLogSchema.safeParse({ avgHeartrate: 10 }).success).toBe(false);
    expect(updateWorkoutLogSchema.safeParse({ maxHeartrate: 251 }).success).toBe(false);
  });

  it("accepts physiological heart rates and allows clearing via null", () => {
    expect(updateWorkoutLogSchema.safeParse({ avgHeartrate: 145, maxHeartrate: 178 }).success).toBe(true);
    expect(updateWorkoutLogSchema.safeParse({ avgHeartrate: null }).success).toBe(true);
  });

  it("rejects a negative distance and accepts a valid one", () => {
    expect(updateWorkoutLogSchema.safeParse({ distanceMeters: -1 }).success).toBe(false);
    expect(updateWorkoutLogSchema.safeParse({ distanceMeters: 5000 }).success).toBe(true);
  });
});

describe("set time bounds are minutes-shaped (audit C7)", () => {
  const run = (time: number) =>
    exercisesPayloadSchema.safeParse([
      { exerciseName: "Run", category: "running", sets: [{ setNumber: 1, distance: 5000, time }] },
    ]);

  it("accepts a realistic session length in minutes", () => {
    expect(run(30).success).toBe(true);
  });

  it("accepts a sub-minute step target, which the column now stores as a fraction", () => {
    // A 45-second structure step converts to 0.75 on the way in.
    expect(run(0.75).success).toBe(true);
  });

  it("rejects a seconds-shaped value for the same session", () => {
    // 1800 is 30 minutes in seconds, but 30 HOURS in this column. The bound used
    // to be max(86_400) -- seconds in a day -- which permitted a 60-day set and
    // so could never catch a seconds value written into a minutes field.
    expect(run(1800).success).toBe(false);
  });

  it("bounds a set at 24 hours", () => {
    expect(SET_TIME_MAX_MINUTES).toBe(1_440);
    expect(run(SET_TIME_MAX_MINUTES).success).toBe(true);
    expect(run(SET_TIME_MAX_MINUTES + 1).success).toBe(false);
  });
});
