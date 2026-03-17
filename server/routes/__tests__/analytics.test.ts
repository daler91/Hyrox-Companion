import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import analyticsRouter, { validDate } from "../analytics";
import { storage } from "../../storage";
import { calculatePersonalRecords, calculateExerciseAnalytics } from "../../services/analyticsService";

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

  const testInvalidDates = (endpoint: string) => {
    it("should return 400 for invalid from date", async () => {
      const response = await request(app).get(`${endpoint}?from=invalid-date`);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid 'from' date format" });
    });

    it("should return 400 for invalid to date", async () => {
      const response = await request(app).get(`${endpoint}?to=invalid-date`);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid 'to' date format" });
    });
  };

  const testEndpoint = (endpoint: string, mockMethod: any, expectedBody: any) => {
    describe(`GET ${endpoint}`, () => {
      it("should return analytics for a user", async () => {
        vi.mocked(storage.getAllExerciseSetsWithDates).mockResolvedValue([
          { id: "set1", exerciseName: "Test", weight: "100", reps: 10 } as any
        ]);

        vi.mocked(mockMethod).mockReturnValue(expectedBody);

        const response = await request(app).get(endpoint);

        expect(response.status).toBe(200);
        expect(storage.getAllExerciseSetsWithDates).toHaveBeenCalledWith("test_user_id", undefined, undefined);
        expect(mockMethod).toHaveBeenCalledWith([
          expect.objectContaining({ id: "set1", exerciseName: "Test", weight: "100", reps: 10 })
        ]);
        expect(response.body).toEqual(expectedBody);
      });

      it("should handle from and to date queries properly", async () => {
        vi.mocked(storage.getAllExerciseSetsWithDates).mockResolvedValue([]);
        vi.mocked(mockMethod).mockReturnValue({});

        const response = await request(app).get(`${endpoint}?from=2024-01-01&to=2024-12-31`);

        expect(response.status).toBe(200);
        expect(storage.getAllExerciseSetsWithDates).toHaveBeenCalledWith("test_user_id", "2024-01-01", "2024-12-31");
      });

      testInvalidDates(endpoint);

      it("should return 500 when storage throws an error", async () => {
        vi.mocked(storage.getAllExerciseSetsWithDates).mockRejectedValue(new Error("Database error"));

        const response = await request(app).get(endpoint);

        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty("error");
      });
    });
  };

  testEndpoint("/api/v1/personal-records", calculatePersonalRecords, { Squat: { weight: "100", reps: 10, estimated1RM: 133 } });
  testEndpoint("/api/v1/exercise-analytics", calculateExerciseAnalytics, { "Bench Press": { totalVolume: 1000, setsCount: 1, history: [] } });

  describe("getExerciseSetsCoalesced caching logic", () => {
    const makeRequest = () => request(app).get("/api/v1/personal-records");

    it("should coalesce concurrent requests to the database", async () => {
      let resolvePromise: (value: any) => void;
      const delayedPromise = new Promise<any[]>((resolve) => {
        resolvePromise = resolve;
      });

      vi.mocked(storage.getAllExerciseSetsWithDates).mockImplementation(() => delayedPromise as any);

      const p1 = makeRequest();
      const p2 = makeRequest();
      const p3 = makeRequest();

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
      vi.mocked(storage.getAllExerciseSetsWithDates).mockResolvedValue([]);

      await makeRequest();
      await makeRequest();

      expect(storage.getAllExerciseSetsWithDates).toHaveBeenCalledTimes(2);
    });

    it("should clear cache if the promise rejects so subsequent requests retry", async () => {
      vi.mocked(storage.getAllExerciseSetsWithDates)
        .mockRejectedValueOnce(new Error("Database error"))
        .mockResolvedValueOnce([]);

      const res1 = await makeRequest();
      const res2 = await makeRequest();

      expect(res1.status).toBe(500);
      expect(res2.status).toBe(200);

      expect(storage.getAllExerciseSetsWithDates).toHaveBeenCalledTimes(2);
    });
  });
});
