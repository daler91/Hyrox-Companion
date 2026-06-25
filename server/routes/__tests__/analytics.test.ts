import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { env } from "../../env";
import { calculateExerciseAnalytics, calculatePersonalRecords, calculateTrainingOverview } from "../../services/analyticsService";
import { storage } from "../../storage";
import analyticsRouter, { _cacheForTesting, _prCacheForTesting, _workoutLogCacheForTesting, addCalendarDays,todayUtcYyyyMmDd, validDate } from "../analytics";
import { createTestApp, resetRouteTestState } from "./testUtils";

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
      getExerciseLoadTags: vi.fn(),
      getAllExerciseSetsWithDates: vi.fn(),
      getExerciseSetsForPersonalRecords: vi.fn(),
      getWorkoutLogsByDateRange: vi.fn(),
    },
    users: {
      getUser: vi.fn(),
    },
  },
}));

vi.mock("../../db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

// Mock the analyticsService functions
vi.mock("../../services/analyticsService", () => ({
  calculatePersonalRecords: vi.fn(),
  calculateExerciseAnalytics: vi.fn(),
  calculateTrainingOverview: vi.fn(),
}));

describe("Analytics Routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    await resetRouteTestState();
    vi.clearAllMocks();
    env.INTERNAL_ANALYTICS_SECRET = "internal-secret";
    _cacheForTesting.clear();
    _prCacheForTesting.clear();
    _workoutLogCacheForTesting.clear();
    vi.mocked(storage.users.getUser).mockResolvedValue({ weeklyGoal: 5 });
    vi.mocked(storage.analytics.getExerciseLoadTags).mockResolvedValue([]);
    app = createTestApp(analyticsRouter);
  });

  describe("todayUtcYyyyMmDd", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should return today's date in YYYY-MM-DD format (UTC)", () => {
      // Set to exactly midnight UTC
      vi.setSystemTime(new Date("2024-05-15T00:00:00Z"));
      expect(todayUtcYyyyMmDd()).toBe("2024-05-15");

      // Set to late evening UTC
      vi.setSystemTime(new Date("2024-05-15T23:59:59Z"));
      expect(todayUtcYyyyMmDd()).toBe("2024-05-15");
    });

    it("should handle leap years correctly", () => {
      vi.setSystemTime(new Date("2024-02-29T12:00:00Z"));
      expect(todayUtcYyyyMmDd()).toBe("2024-02-29");
    });
  });

  describe("addCalendarDays", () => {
    it("should add days to a date string", () => {
      expect(addCalendarDays("2024-05-15", 5)).toBe("2024-05-20");
    });

    it("should subtract days from a date string", () => {
      expect(addCalendarDays("2024-05-15", -5)).toBe("2024-05-10");
    });

    it("should handle month boundaries", () => {
      expect(addCalendarDays("2024-05-31", 1)).toBe("2024-06-01");
      expect(addCalendarDays("2024-05-01", -1)).toBe("2024-04-30");
    });

    it("should handle leap years", () => {
      expect(addCalendarDays("2024-02-28", 1)).toBe("2024-02-29");
      expect(addCalendarDays("2024-02-29", 1)).toBe("2024-03-01");
    });

    it("should handle year boundaries", () => {
      expect(addCalendarDays("2024-12-31", 1)).toBe("2025-01-01");
      expect(addCalendarDays("2025-01-01", -1)).toBe("2024-12-31");
    });
  });

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

  const testEndpoint = (endpoint: string, mockMethod: ReturnType<typeof vi.fn>, expectedBody: Record<string, unknown>, storageMethod: ReturnType<typeof vi.fn>) => {
    describe(`GET ${endpoint}`, () => {
      it("should return analytics for a user", async () => {
        vi.mocked(storageMethod).mockResolvedValue([
          { id: "set1", exerciseName: "Test", weight: "100", reps: 10 }
        ]);

        vi.mocked(mockMethod).mockReturnValue(expectedBody);

        const response = await request(app).get(endpoint);

        expect(response.status).toBe(200);
        expect(storageMethod).toHaveBeenCalledWith("test_user_id", undefined, undefined);
        expect(mockMethod).toHaveBeenCalledWith([
          expect.objectContaining({ id: "set1", exerciseName: "Test", weight: "100", reps: 10 })
        ]);
        expect(response.body).toEqual(expectedBody);
      });

      it("should handle from and to date queries properly", async () => {
        vi.mocked(storageMethod).mockResolvedValue([]);
        vi.mocked(mockMethod).mockReturnValue({});

        const response = await request(app).get(`${endpoint}?from=2024-01-01&to=2024-12-31`);

        expect(response.status).toBe(200);
        expect(storageMethod).toHaveBeenCalledWith("test_user_id", "2024-01-01", "2024-12-31");
      });

      it("clamps a future 'to' date to today", async () => {
        vi.mocked(storageMethod).mockResolvedValue([]);
        vi.mocked(mockMethod).mockReturnValue({});
        // A distant future "to" should be silently clamped rather than
        // flowing through to the DB (otherwise users get an empty page).
        const response = await request(app).get(`${endpoint}?from=2020-01-01&to=2099-12-31`);

        expect(response.status).toBe(200);
        const call = vi.mocked(storageMethod).mock.calls[0];
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
        vi.mocked(storageMethod).mockRejectedValue(new Error("Database error"));

        const response = await request(app).get(endpoint);

        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty("error");
      });
    });
  };

  testEndpoint("/api/v1/personal-records", calculatePersonalRecords, { Squat: { weight: "100", reps: 10, estimated1RM: 133 } }, storage.analytics.getExerciseSetsForPersonalRecords);
  testEndpoint("/api/v1/exercise-analytics", calculateExerciseAnalytics, { "Bench Press": { totalVolume: 1000, setsCount: 1, history: [] } }, storage.analytics.getAllExerciseSetsWithDates);

  describe("getExerciseSetsCoalesced caching logic", () => {
    const makeRequest = () => request(app).get("/api/v1/exercise-analytics");

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

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
      avgCompliancePct: null,
    } as const;
    const emptyTrainingLoad = {
      currentUtss: 0,
      acuteAvg: 0,
      chronicAvg: 0,
      acwr: null,
      zone: "insufficient_data" as const,
      tsb: null,
      monotony: null,
      strain: null,
      monotonyZone: "ok" as const,
      hrTss: null,
      hrZone: null,
      tss: null,
      hrZones: [],
      estimatedLthr: 0,
      powerTssEstimated: true,
      flaggedVectors: [],
      activeRestrictions: [],
      downshiftRationale: null,
      trend: [],
    };
    const makeTrainingOverview = (
      overrides: Partial<ReturnType<typeof calculateTrainingOverview>> = {},
    ): ReturnType<typeof calculateTrainingOverview> => ({
      weeklySummaries: [],
      workoutDates: [],
      categoryTotals: {},
      stationCoverage: [],
      movementPatternCoverage: [],
      muscleGroupCoverage: [],
      currentStreak: 0,
      weeklyCompletedWorkouts: 0,
      weeklyGoal: 5,
      currentStats: zeroStats,
      trainingLoad: emptyTrainingLoad,
      ...overrides,
    });

    it("should return training overview data", async () => {
      const mockOverview = makeTrainingOverview({
        weeklySummaries: [{ weekStart: "2026-01-12", workoutCount: 3 }],
        workoutDates: ["2026-01-13"],
        currentStats: { ...zeroStats, totalWorkouts: 3, avgPerWeek: 3 },
      });

      vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
      vi.mocked(calculateTrainingOverview).mockReturnValue(mockOverview);

      const response = await request(app).get("/api/v1/training-overview");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockOverview);
      // No `from` query param → no previous-window fetch.
      expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith("test_user_id", undefined, undefined);
      expect(storage.analytics.getAllExerciseSetsWithDates).toHaveBeenCalledWith("test_user_id", undefined, undefined);
      expect(storage.analytics.getExerciseLoadTags).toHaveBeenCalled();
      expect(storage.users.getUser).toHaveBeenCalledWith("test_user_id");
      expect(calculateTrainingOverview).toHaveBeenCalled();
    });


    it("treats exercise_sets as authoritative for mixed records (legacy text + sets)", async () => {
      vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([
        { id: "log-1", userId: "test_user_id", date: "2026-02-01", mainWorkout: "Legacy: row 3x500m" },
      ]);
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([
        { id: "set-1", workoutLogId: "log-1", exerciseName: "SkiErg", reps: null, distance: "1000", date: "2026-02-01" },
      ]);
      vi.mocked(calculateTrainingOverview).mockReturnValue(makeTrainingOverview({
        workoutDates: ["2026-02-01"],
      }));

      const response = await request(app).get("/api/v1/training-overview");
      expect(response.status).toBe(200);
      expect(calculateTrainingOverview).toHaveBeenCalledWith(
        expect.any(Array),
        expect.arrayContaining([expect.objectContaining({ exerciseName: "SkiErg" })]),
        undefined,
        expect.objectContaining({
          weeklyGoal: 5,
          loadTags: [],
          trainingLoadInput: expect.objectContaining({
            workoutLogs: expect.any(Array),
            exerciseSets: expect.any(Array),
            currentDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          }),
          weightUnit: "kg",
          athlete: { age: null, gender: null, restingHr: null, maxHr: null, ftp: null },
        }),
      );
    });
    it("should pass date params to storage", async () => {
      vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
      vi.mocked(calculateTrainingOverview).mockReturnValue(makeTrainingOverview());

      const response = await request(app).get("/api/v1/training-overview?from=2026-01-01&to=2026-03-31");

      expect(response.status).toBe(200);
      expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith("test_user_id", "2026-01-01", "2026-03-31");
    });

    it("fetches a same-length previous window when `from` is set", async () => {
      vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
      vi.mocked(calculateTrainingOverview).mockReturnValue(makeTrainingOverview({
        previousStats: zeroStats,
      }));

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
      vi.mocked(calculateTrainingOverview).mockReturnValue(makeTrainingOverview());

      await request(app).get("/api/v1/training-overview");

      // Only the current window and load-history fetches happen; no previous-window fetch.
      expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledTimes(2);
      // calculateTrainingOverview invoked with `undefined` for the previous logs arg.
      expect(vi.mocked(calculateTrainingOverview).mock.calls[0][2]).toBeUndefined();
    });

    it("passes the user's weekly goal into the overview calculator", async () => {
      vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
      vi.mocked(storage.users.getUser).mockResolvedValue({ weeklyGoal: 7 });
      vi.mocked(calculateTrainingOverview).mockReturnValue(makeTrainingOverview({
        weeklyGoal: 7,
      }));

      await request(app).get("/api/v1/training-overview");

      expect(calculateTrainingOverview).toHaveBeenCalledWith(
        [],
        [],
        undefined,
        expect.objectContaining({
          weeklyGoal: 7,
          loadTags: [],
          trainingLoadInput: expect.objectContaining({
            workoutLogs: [],
            exerciseSets: [],
            currentDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          }),
          weightUnit: "kg",
          athlete: { age: null, gender: null, restingHr: null, maxHr: null, ftp: null },
        }),
      );
    });

    it("passes the user's weight unit into the overview calculator", async () => {
      vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
      vi.mocked(storage.users.getUser).mockResolvedValue({ weeklyGoal: 5, weightUnit: "lbs" });
      vi.mocked(calculateTrainingOverview).mockReturnValue(makeTrainingOverview());

      await request(app).get("/api/v1/training-overview");

      // weightUnit is nested in the options object (4th arg) to calculateTrainingOverview.
      expect(vi.mocked(calculateTrainingOverview).mock.calls[0][3]?.weightUnit).toBe("lbs");
    });

    testInvalidDates("/api/v1/training-overview");
  });

  describe("GET /api/v1/analytics/internal/structured-exercise-health", () => {
    it("returns 401 when the internal analytics secret is not configured", async () => {
      env.INTERNAL_ANALYTICS_SECRET = undefined;

      const response = await request(app)
        .get("/api/v1/analytics/internal/structured-exercise-health")
        .set("x-internal-analytics-secret", "internal-secret");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
      expect(db.execute).not.toHaveBeenCalled();
    });

    it("returns 401 when the internal analytics secret is missing or wrong", async () => {
      const missing = await request(app).get("/api/v1/analytics/internal/structured-exercise-health");
      const wrong = await request(app)
        .get("/api/v1/analytics/internal/structured-exercise-health")
        .set("x-internal-analytics-secret", "wrong-secret");

      expect(missing.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(db.execute).not.toHaveBeenCalled();
    });

    it("returns structured exercise health data when the secret matches", async () => {
      vi.mocked(db.execute)
        .mockResolvedValueOnce({ rows: [{ day: "2026-05-16", total_rows: 10, structured_rows: 8, legacy_only_rows: 2, failed_hydration_backlog: 1, legacy_only_pct: 20 }] })
        .mockResolvedValueOnce({ rows: [{ day: "2026-05-16", owner_type: "workout", source: "manual", counter_name: "parse_text_succeeded", value: 3 }] });

      const response = await request(app)
        .get("/api/v1/analytics/internal/structured-exercise-health")
        .set("x-internal-analytics-secret", "internal-secret");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        rollups: [{ day: "2026-05-16", total_rows: 10, structured_rows: 8, legacy_only_rows: 2, failed_hydration_backlog: 1, legacy_only_pct: 20 }],
        counters: [{ day: "2026-05-16", owner_type: "workout", source: "manual", counter_name: "parse_text_succeeded", value: 3 }],
      });
      expect(db.execute).toHaveBeenCalledTimes(2);
    });
  });
});
