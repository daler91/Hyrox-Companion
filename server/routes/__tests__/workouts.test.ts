import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { AuthenticatedRequest } from "../../types";
import workoutsRouter from "../workouts";

// Mock the clerkAuth middleware to simulate authentication
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: AuthenticatedRequest, res: any, next: any) => {
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
    listWorkoutLogs: vi.fn(),
  },
}));

// Mock the workoutService functions
vi.mock("../../services/workoutService", () => ({
  createWorkout: vi.fn(),
  updateWorkout: vi.fn(),
  reparseWorkout: vi.fn(),
}));

// Mock the exportService functions
vi.mock("../../services/exportService", () => ({
  generateCSV: vi.fn(),
  generateJSON: vi.fn(),
}));

describe("Workouts Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use(workoutsRouter);
  });


  describe("GET /api/workouts", () => {
    it("should return a list of workout logs for a user", async () => {
      // Mock the storage response
      const mockStorage = await import("../../storage");
      const { storage } = mockStorage as any;

      const mockLogs = [
        { id: "1", userId: "test_user_id", date: "2024-03-10", notes: "Great workout" },
        { id: "2", userId: "test_user_id", date: "2024-03-12", notes: "Felt tired" }
      ];
      storage.listWorkoutLogs.mockResolvedValue(mockLogs);

      const response = await request(app).get("/api/workouts");

      expect(response.status).toBe(200);
      expect(storage.listWorkoutLogs).toHaveBeenCalledWith("test_user_id");
      expect(response.body).toEqual(mockLogs);
    });

    it("should return 500 when storage throws an error", async () => {
      // Mock the storage to throw an error
      const mockStorage = await import("../../storage");
      const { storage } = mockStorage as any;
      storage.listWorkoutLogs.mockRejectedValue(new Error("Database error"));

      const response = await request(app).get("/api/workouts");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Failed to list workouts" });
    });
  });
});
