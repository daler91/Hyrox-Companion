import { createTestApp } from "./testUtils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import workoutsRouter from "../workouts";
import { clearRateLimitBuckets } from "../../routeUtils";

// Mock the clerkAuth middleware to simulate authentication
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
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
    workouts: {
      listWorkoutLogs: vi.fn(),
    },
  },
}));

// Mock the workoutService functions
vi.mock("../../queue", () => ({ queue: { send: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../../services/workoutService", () => ({
  createWorkout: vi.fn(),
  createWorkoutAndScheduleCoaching: vi.fn(),
  updateWorkout: vi.fn(),
  reparseWorkout: vi.fn(),
  validateExercisesPayload: (exercises: unknown) => ({ success: true, data: exercises }),
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
    clearRateLimitBuckets();
    app = createTestApp(workoutsRouter);

  });



  describe("POST /api/workouts", () => {
    it("should return 500 when createWorkout throws an error", async () => {
      // Mock the createWorkoutAndScheduleCoaching use case to throw an error
      const { createWorkoutAndScheduleCoaching } = await import("../../services/workoutService");
      vi.mocked(createWorkoutAndScheduleCoaching).mockRejectedValue(new Error("Service error"));



      const response = await request(app)
        .post("/api/v1/workouts")
        .send({
          date: "2024-03-10",
          notes: "Test notes",
          focus: "Conditioning",
          mainWorkout: "Murph",
          exercises: []
        });



      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" });
    });
  });

  describe("GET /api/workouts", () => {
    it("should return a list of workout logs for a user", async () => {
      // Mock the storage response
      const { storage } = await import("../../storage");

      const mockLogs = [
        { id: "1", userId: "test_user_id", date: "2024-03-10", notes: "Great workout" },
        { id: "2", userId: "test_user_id", date: "2024-03-12", notes: "Felt tired" }
      ];
      vi.mocked(storage.workouts.listWorkoutLogs).mockResolvedValue(mockLogs);

      const response = await request(app).get("/api/v1/workouts");

      expect(response.status).toBe(200);
      expect(storage.workouts.listWorkoutLogs).toHaveBeenCalledWith("test_user_id", 50, undefined);
      expect(response.body).toEqual(mockLogs);
    });

    it("should return 500 when storage throws an error", async () => {
      // Mock the storage to throw an error
      const { storage } = await import("../../storage");
      vi.mocked(storage.workouts.listWorkoutLogs).mockRejectedValue(new Error("Database error"));

      const response = await request(app).get("/api/v1/workouts");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" });
    });
  });
});
