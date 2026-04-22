import express from "express";
import request from "supertest";
import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { calculateExerciseAnalytics, calculatePersonalRecords, calculateTrainingOverview } from "../../services/analyticsService";
import { storage } from "../../storage";
import analyticsRouter, { _cacheForTesting, _workoutLogCacheForTesting,validDate } from "../analytics";
import { createTestApp } from "./testUtils";

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
    analytics: {
      getAllExerciseSetsWithDates: vi.fn(),
      getWorkoutLogsByDateRange: vi.fn(),
    },
  },
}));

// Mock the analyticsService functions
vi.mock("../../services/analyticsService", () => ({
  calculatePersonalRecords: vi.fn(),
  calculateExerciseAnalytics: vi.fn(),
  calculateTrainingOverview: vi.fn(),
}));

import { clearRateLimitBuckets } from "../../routeUtils";

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
    clearRateLimitBuckets();
    vi.clearAllMocks();
    _cacheForTesting.clear();
    _workoutLogCacheForTesting.clear();
    app = createTestApp(analyticsRouter);
  });

  const testInvalidDates = (endpoint: string) => {
    it("should return 400 for invalid from date", async () => {
      const response = await request(app).get(`${endpoint}?from=invalid-date`);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid 'from' date format", code: "BAD_REQUEST" });
    });

    it("should return 400 for invalid to date", async () => {
      const response = await request(app).get(`${endpoint}?to=invalid-date`);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Invalid 'to' date format", code: "BAD_REQUEST" });
    });
  };

  const testEndpoint = (endpoint: string, mockMethod: ReturnType<typeof vi.fn>, expectedBody: Record<string, unknown>) => {
    describe(`GET ${endpoint}`, () => {
      it("should return analytics for a user", async () => {
        vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([
          { id: "set1", exerciseName: "Test", weight: "100", reps: 10 } as unknown as Awaited<ReturnType<typeof storage.analytics.getAllExerciseSetsWithDates>>[number]
        ]);

        vi.mocked(mockMethod).mockReturnValue(expectedBody);

        const response = await request(app).get(endpoint);

        expect(response.status).toBe(200);
        expect(storage.analytics.getAllExerciseSetsWithDates).toHaveBeenCalledWith("test_user_id", undefined, undefined);
        expect(mockMethod).toHaveBeenCalledWith([
          expect.objectContaining({ id: "set1", exerciseName: "Test", weight: "100", reps: 10 })
        ]);
        expect(response.body).toEqual(expectedBody);
      });

      it("should handle from and to date queries properly", async () => {
        vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
        vi.mocked(mockMethod).mockReturnValue({});

        const response = await request(app).get(`${endpoint}?from=2024-01-01&to=2024-12-31`);

        expect(response.status).toBe(200);
        expect(storage.analytics.getAllExerciseSetsWithDates).toHaveBeenCalledWith("test_user_id", "2024-01-01", "2024-12-31");
      });

      it("clamps a future 'to' date to today", async () => {
        vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
        vi.mocked(mockMethod).mockReturnValue({});
        // A distant future "to" should be silently clamped rather than
        // flowing through to the DB (otherwise users get an empty page).
        const response = await request(app).get(`${endpoint}?from=2020-01-01&to=2099-12-31`);

        expect(response.status).toBe(200);
        const call = vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mock.calls[0];
        expect(call[0]).toBe("test_user_id");
        expect(call[1]).toBe("2020-01-01");
        // Clamped value should be today's UTC date string — never 2099.
        expect(call[2]).not.toBe("2099-12-31");
        expect(call[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const today = new Date().toISOString().split("T")[0];
        expect(call[2]).toBe(today);
      });

      testInvalidDates(endpoint);

      it("should return 500 when storage throws an error", async () => {
        vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockRejectedValue(new Error("Database error"));

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
      type ExerciseSetWithDate = Awaited<ReturnType<typeof storage.analytics.getAllExerciseSetsWithDates>>;
      let resolvePromise: (value: ExerciseSetWithDate) => void;
      const delayedPromise = new Promise<ExerciseSetWithDate>((resolve) => {
        resolvePromise = resolve;
      });

      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockImplementation(() => delayedPromise);

      const p1 = makeRequest();
      const p2 = makeRequest();
      const p3 = makeRequest();

      // Advance timers to trigger the timeout resolution if needed,
      // but here we just manually resolve the promise right away since we are coalescing
      resolvePromise([
        { id: "set1", exerciseName: "Squat", weight: "100", reps: 10 }
      ]);

      // Allow the event loop to tick so the promises can resolve
      vi.advanceTimersByTime(50);

      const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(200);

      expect(storage.analytics.getAllExerciseSetsWithDates).toHaveBeenCalledTimes(1);
    });

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should coalesce sequential requests within the 5-minute TTL", async () => {
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);

      await makeRequest();
      await makeRequest();

      expect(storage.analytics.getAllExerciseSetsWithDates).toHaveBeenCalledTimes(1);
    });

    it("should refetch from DB after the 5-minute TTL expires", async () => {
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);

      await makeRequest();

      // Advance time by 5 minutes + 1 second
      vi.advanceTimersByTime((5 * 60 * 1000) + 1000);

      await makeRequest();

      expect(storage.analytics.getAllExerciseSetsWithDates).toHaveBeenCalledTimes(2);
    });

    it("should clear cache if the promise rejects so subsequent requests retry immediately", async () => {
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates)
        .mockRejectedValueOnce(new Error("Database error"))
        .mockResolvedValueOnce([]);

      const res1 = await makeRequest();
      const res2 = await makeRequest();

      expect(res1.status).toBe(500);
      expect(res2.status).toBe(200);

      // Even without advancing time, the cache should clear on failure
      expect(storage.analytics.getAllExerciseSetsWithDates).toHaveBeenCalledTimes(2);
    });
  });

  describe("GET /api/v1/training-overview", () => {
    const zeroStats = {
      totalWorkouts: 0,
      avgPerWeek: 0,
      totalDuration: 0,
      avgDuration: 0,
      avgRpe: null,
    } as const;

    it("should return training overview data", async () => {
      const mockOverview = {
        weeklySummaries: [{ weekStart: "2026-01-12", workoutCount: 3 }],
        workoutDates: ["2026-01-13"],
        categoryTotals: {},
        stationCoverage: [],
        currentStats: { ...zeroStats, totalWorkouts: 3, avgPerWeek: 3 },
      };

      vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
      vi.mocked(calculateTrainingOverview).mockReturnValue(mockOverview as never);

      const response = await request(app).get("/api/v1/training-overview");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockOverview);
      // No `from` query param → no previous-window fetch.
      expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith("test_user_id", undefined, undefined);
      expect(storage.analytics.getAllExerciseSetsWithDates).toHaveBeenCalledWith("test_user_id", undefined, undefined);
      expect(calculateTrainingOverview).toHaveBeenCalled();
    });

    it("should pass date params to storage", async () => {
      vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
      vi.mocked(calculateTrainingOverview).mockReturnValue({
        weeklySummaries: [],
        workoutDates: [],
        categoryTotals: {},
        stationCoverage: [],
        currentStats: zeroStats,
      } as never);

      const response = await request(app).get("/api/v1/training-overview?from=2026-01-01&to=2026-03-31");

      expect(response.status).toBe(200);
      expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith("test_user_id", "2026-01-01", "2026-03-31");
    });

    it("fetches a same-length previous window when `from` is set", async () => {
      vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
      vi.mocked(calculateTrainingOverview).mockReturnValue({
        weeklySummaries: [],
        workoutDates: [],
        categoryTotals: {},
        stationCoverage: [],
        currentStats: zeroStats,
        previousStats: zeroStats,
      } as never);

      await request(app).get("/api/v1/training-overview?from=2026-02-01&to=2026-02-28");

      // Current window: 2026-02-01 → 2026-02-28 (28 days).
      // Previous window must end one day before 2026-02-01 and be 28 days long.
      // That gives 2026-01-04 → 2026-01-31.
      const calls = vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mock.calls;
      expect(calls).toContainEqual(["test_user_id", "2026-02-01", "2026-02-28"]);
      expect(calls).toContainEqual(["test_user_id", "2026-01-04", "2026-01-31"]);
      // calculateTrainingOverview is invoked with the previous logs as the 3rd arg.
      expect(vi.mocked(calculateTrainingOverview).mock.calls[0][2]).toEqual([]);
    });

    it("skips the previous-window fetch when `from` is absent", async () => {
      vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
      vi.mocked(calculateTrainingOverview).mockReturnValue({
        weeklySummaries: [],
        workoutDates: [],
        categoryTotals: {},
        stationCoverage: [],
        currentStats: zeroStats,
      } as never);

      await request(app).get("/api/v1/training-overview");

      // Only the current window fetch happens.
      expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledTimes(1);
      // calculateTrainingOverview invoked with `undefined` for the previous logs arg.
      expect(vi.mocked(calculateTrainingOverview).mock.calls[0][2]).toBeUndefined();
    });

    testInvalidDates("/api/v1/training-overview");
  });
});
