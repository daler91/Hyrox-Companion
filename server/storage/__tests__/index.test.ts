import { describe, it, expect } from "vitest";
import { storage } from "../index";

describe("DatabaseStorage delegation", () => {
  it("should implement methods defined in IStorage interface via delegation", () => {
    // We test a representative method from each underlying storage class
    // to ensure the proxy correctly delegates calls.

    // From UserStorage
    expect(typeof storage.getUser).toBe("function");
    expect(typeof storage.upsertUser).toBe("function");

    // From WorkoutStorage
    expect(typeof storage.createWorkoutLog).toBe("function");
    expect(typeof storage.getWorkoutLog).toBe("function");

    // From PlanStorage
    expect(typeof storage.createTrainingPlan).toBe("function");
    expect(typeof storage.getTrainingPlan).toBe("function");

    // From TimelineStorage
    expect(typeof storage.getTimeline).toBe("function");

    // From AnalyticsStorage
    expect(typeof storage.getWeeklyStats).toBe("function");
    expect(typeof storage.getAllExerciseSetsWithDates).toBe("function");
  });

  it("should return undefined for non-existent properties", () => {
    const storageAny = storage as any;
    expect(storageAny.nonExistentMethod).toBeUndefined();
  });
});
