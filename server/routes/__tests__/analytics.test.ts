import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import analyticsRouter, { validDate } from "../analytics";

// Mock the clerkAuth middleware to simulate authentication
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: any, res: any, next: any) => {
    req.auth = { userId: "test_user_id" };
    next();
  },
}));

// Mock the getUserId function to return our test user
vi.mock("../../types", () => ({
  getUserId: () => "test_user_id",
}));

// Mock the storage functions
vi.mock("../../storage", () => ({
  storage: {
    getAllExerciseSetsWithDates: vi.fn(),
  },
}));

// Mock the analyticsService functions
vi.mock("../../services/analyticsService", () => ({
  calculatePersonalRecords: vi.fn(),
  calculateExerciseAnalytics: vi.fn(),
}));

describe("Analytics Routes", () => {
  describe("validDate", () => {
    it("should return undefined for falsy values", () => {
      expect(validDate(undefined)).toBeUndefined();
      expect(validDate(null)).toBeUndefined();
      expect(validDate("")).toBeUndefined();
    });

    it("should return undefined for invalid date strings", () => {
      expect(validDate("not-a-date")).toBeUndefined();
            expect(validDate("12/12/2024")).toBeUndefined();
    });

    it("should return the date string for valid date strings", () => {
      expect(validDate("2024-01-01")).toBe("2024-01-01");
      expect(validDate("2024-12-31")).toBe("2024-12-31");
    });
  });


  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use(analyticsRouter);
  });

  describe("GET /api/personal-records", () => {
    it("should return personal records for a user", async () => {
      // Mock the storage response
      const { storage } = (await import("../../storage")) as any;
      storage.getAllExerciseSetsWithDates.mockResolvedValue([
        { id: "set1", exerciseName: "Squat", weight: "100", reps: 10 }
      ]);

      // Mock the analytics service response
      const { calculatePersonalRecords } = (await import("../../services/analyticsService")) as any;
      calculatePersonalRecords.mockReturnValue({
        Squat: { weight: "100", reps: 10, estimated1RM: 133 }
      });

      const response = await request(app).get("/api/personal-records");

      expect(response.status).toBe(200);
      expect(storage.getAllExerciseSetsWithDates).toHaveBeenCalledWith("test_user_id", undefined, undefined);
      expect(calculatePersonalRecords).toHaveBeenCalledWith([
        { id: "set1", exerciseName: "Squat", weight: "100", reps: 10 }
      ]);
      expect(response.body).toEqual({
        Squat: { weight: "100", reps: 10, estimated1RM: 133 }
      });
    });

    it("should handle from and to date queries properly", async () => {
      // Mock the storage response
      const { storage } = (await import("../../storage")) as any;
      storage.getAllExerciseSetsWithDates.mockResolvedValue([]);

      // Mock the analytics service response
      const { calculatePersonalRecords } = (await import("../../services/analyticsService")) as any;
      calculatePersonalRecords.mockReturnValue({});

      const response = await request(app).get("/api/personal-records?from=2024-01-01&to=2024-12-31");

      expect(response.status).toBe(200);
      expect(storage.getAllExerciseSetsWithDates).toHaveBeenCalledWith("test_user_id", "2024-01-01", "2024-12-31");
    });

    it("should return 400 for invalid from date", async () => {
      const response = await request(app).get("/api/personal-records?from=invalid-date");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid 'from' date format" });
    });

    it("should return 400 for invalid to date", async () => {
      const response = await request(app).get("/api/personal-records?to=invalid-date");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid 'to' date format" });
    });


    it("should return 500 when storage throws an error", async () => {
      // Mock the storage to throw an error
      const { storage } = (await import("../../storage")) as any;
      storage.getAllExerciseSetsWithDates.mockRejectedValue(new Error("Database error"));

      const response = await request(app).get("/api/personal-records");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Failed to fetch personal records" });
    });
  });

  describe("GET /api/exercise-analytics", () => {
    it("should return exercise analytics for a user", async () => {
      // Mock the storage response
      const { storage } = (await import("../../storage")) as any;
      storage.getAllExerciseSetsWithDates.mockResolvedValue([
        { id: "set1", exerciseName: "Bench Press", weight: "200", reps: 5 }
      ]);

      // Mock the analytics service response
      const { calculateExerciseAnalytics } = (await import("../../services/analyticsService")) as any;
      calculateExerciseAnalytics.mockReturnValue({
        "Bench Press": { totalVolume: 1000, setsCount: 1, history: [] }
      });

      const response = await request(app).get("/api/exercise-analytics");

      expect(response.status).toBe(200);
      expect(storage.getAllExerciseSetsWithDates).toHaveBeenCalledWith("test_user_id", undefined, undefined);
      expect(calculateExerciseAnalytics).toHaveBeenCalledWith([
        { id: "set1", exerciseName: "Bench Press", weight: "200", reps: 5 }
      ]);
      expect(response.body).toEqual({
        "Bench Press": { totalVolume: 1000, setsCount: 1, history: [] }
      });
    });

    it("should handle from and to date queries properly", async () => {
      // Mock the storage response
      const { storage } = (await import("../../storage")) as any;
      storage.getAllExerciseSetsWithDates.mockResolvedValue([]);

      // Mock the analytics service response
      const { calculateExerciseAnalytics } = (await import("../../services/analyticsService")) as any;
      calculateExerciseAnalytics.mockReturnValue({});

      const response = await request(app).get("/api/exercise-analytics?from=2024-01-01&to=2024-12-31");

      expect(response.status).toBe(200);
      expect(storage.getAllExerciseSetsWithDates).toHaveBeenCalledWith("test_user_id", "2024-01-01", "2024-12-31");
    });

    it("should return 400 for invalid from date", async () => {
      const response = await request(app).get("/api/exercise-analytics?from=invalid-date");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid 'from' date format" });
    });

    it("should return 400 for invalid to date", async () => {
      const response = await request(app).get("/api/exercise-analytics?to=invalid-date");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid 'to' date format" });
    });

    it("should return 500 when storage throws an error", async () => {
      // Mock the storage to throw an error
      const { storage } = (await import("../../storage")) as any;
      storage.getAllExerciseSetsWithDates.mockRejectedValue(new Error("Database error"));

      const response = await request(app).get("/api/exercise-analytics");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Failed to fetch exercise analytics" });
    });
  });

  describe("getExerciseSetsCoalesced caching logic", () => {
    const makeRequest = () => request(app).get("/api/personal-records");

    it("should coalesce concurrent requests to the database", async () => {
      const { storage } = (await import("../../storage")) as any;

      let resolvePromise: (value: any) => void;
      const delayedPromise = new Promise<any[]>((resolve) => {
        resolvePromise = resolve;
      });

      storage.getAllExerciseSetsWithDates.mockImplementation(() => delayedPromise);

      // Start the requests concurrently by wrapping them in promises
      const p1 = makeRequest();
      const p2 = makeRequest();
      const p3 = makeRequest();

      // Give the event loop time to reach the storage call for all requests
      setTimeout(() => {
        resolvePromise([
          { id: "set1", exerciseName: "Squat", weight: "100", reps: 10 }
        ]);
      }, 50);

      const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(200);

      expect(storage.getAllExerciseSetsWithDates).toHaveBeenCalledTimes(1);
    });

    it("should not coalesce sequential requests after the first resolves", async () => {
      const { storage } = (await import("../../storage")) as any;

      storage.getAllExerciseSetsWithDates.mockResolvedValue([]);

      await makeRequest();
      await makeRequest();

      expect(storage.getAllExerciseSetsWithDates).toHaveBeenCalledTimes(2);
    });

    it("should clear cache if the promise rejects so subsequent requests retry", async () => {
      const { storage } = (await import("../../storage")) as any;

      storage.getAllExerciseSetsWithDates.mockRejectedValueOnce(new Error("Database error"));
      storage.getAllExerciseSetsWithDates.mockResolvedValueOnce([]);

      const res1 = await makeRequest();
      const res2 = await makeRequest();

      expect(res1.status).toBe(500);
      expect(res2.status).toBe(200);

      expect(storage.getAllExerciseSetsWithDates).toHaveBeenCalledTimes(2);
    });
  });
});