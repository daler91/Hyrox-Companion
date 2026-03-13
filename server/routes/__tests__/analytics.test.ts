import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import analyticsRouter from "../analytics";

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
      const mockStorage = await import("../../storage");
      const { storage } = mockStorage as any;
      storage.getAllExerciseSetsWithDates.mockResolvedValue([
        { id: "set1", exerciseName: "Squat", weight: "100", reps: 10 }
      ]);

      // Mock the analytics service response
      const mockAnalyticsService = await import("../../services/analyticsService");
      const { calculatePersonalRecords } = mockAnalyticsService as any;
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
      const mockStorage = await import("../../storage");
      const { storage } = mockStorage as any;
      storage.getAllExerciseSetsWithDates.mockResolvedValue([]);

      // Mock the analytics service response
      const mockAnalyticsService = await import("../../services/analyticsService");
      const { calculatePersonalRecords } = mockAnalyticsService as any;
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
      const mockStorage = await import("../../storage");
      const { storage } = mockStorage as any;
      storage.getAllExerciseSetsWithDates.mockRejectedValue(new Error("Database error"));

      const response = await request(app).get("/api/personal-records");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Failed to fetch personal records" });
    });
  });

  describe("GET /api/exercise-analytics", () => {
    it("should return exercise analytics for a user", async () => {
      // Mock the storage response
      const mockStorage = await import("../../storage");
      const { storage } = mockStorage as any;
      storage.getAllExerciseSetsWithDates.mockResolvedValue([
        { id: "set1", exerciseName: "Bench Press", weight: "200", reps: 5 }
      ]);

      // Mock the analytics service response
      const mockAnalyticsService = await import("../../services/analyticsService");
      const { calculateExerciseAnalytics } = mockAnalyticsService as any;
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

    it("should return 500 when storage throws an error", async () => {
      // Mock the storage to throw an error
      const mockStorage = await import("../../storage");
      const { storage } = mockStorage as any;
      storage.getAllExerciseSetsWithDates.mockRejectedValue(new Error("Database error"));

      const response = await request(app).get("/api/exercise-analytics");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Failed to fetch exercise analytics" });
    });
  });
});
