import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Response, NextFunction } from "express";
import { calculateStreak, rateLimiter, clearRateLimitBuckets, DEFAULT_WINDOW_MS } from "./routeUtils";
import { expandExercisesToSetRows } from "./services/workoutService";

describe("rateLimiter", () => {
  let req: any;
  let res: any;
  let next: NextFunction;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    clearRateLimitBuckets();

    req = {
      auth: { userId: "user123" },
      ip: "user-ip-1",
    };

    res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      send: vi.fn(),
    };

    next = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls next() for requests under the limit", async () => {
    const middleware = rateLimiter("api", 2, DEFAULT_WINDOW_MS);

    await middleware(req, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();

    await middleware(req, res as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 429 when maxRequests is exceeded", async () => {
    const middleware = rateLimiter("api", 2, DEFAULT_WINDOW_MS);

    await middleware(req, res as Response, next); // 1st request (ok)
    await middleware(req, res as Response, next); // 2nd request (ok)
    await middleware(req, res as Response, next); // 3rd request (blocked)

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.send).toHaveBeenCalledWith({
      error: "Too many requests. Please try again later.",
    });
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "60");
  });

  it("resets limit after windowMs passes", async () => {
    const middleware = rateLimiter("api", 1, DEFAULT_WINDOW_MS);

    await middleware(req, res as Response, next); // 1st request (ok)
    expect(next).toHaveBeenCalledTimes(1);

    await middleware(req, res as Response, next); // 2nd request (blocked)
    expect(res.status).toHaveBeenCalledWith(429);

    // Advance time by 60 seconds
    vi.advanceTimersByTime(DEFAULT_WINDOW_MS);

    await middleware(req, res as Response, next); // 3rd request (ok again)
    expect(next).toHaveBeenCalledTimes(2);
  });


  it("calls next() and bypasses rate limiting if neither userId nor ip is present", async () => {
    const middleware = rateLimiter("api", 1, DEFAULT_WINDOW_MS);
    const reqEmpty = {};

    await middleware(reqEmpty, res as Response, next); // 1st request empty (ok)
    await middleware(reqEmpty, res as Response, next); // 2nd request empty (ok)

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("distinguishes between different users", async () => {
    const middleware = rateLimiter("api", 1, DEFAULT_WINDOW_MS);

    // User 1 requests
    await middleware(req, res as Response, next); // 1st request user1 (ok)
    expect(next).toHaveBeenCalledTimes(1);

    // User 2 requests
    const req2 = { ...req, auth: { userId: "user456" } };
    await middleware(req2, res as Response, next); // 1st request user2 (ok)
    expect(next).toHaveBeenCalledTimes(2);

    // User 1 requests again (blocked)
    await middleware(req, res as Response, next); // 2nd request user1 (blocked)
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("uses ip address if userId is missing", async () => {
    const middleware = rateLimiter("api", 1, DEFAULT_WINDOW_MS);
    const reqIp = { ip: "user-ip-2" };

    await middleware(reqIp, res as Response, next); // 1st request ip (ok)
    expect(next).toHaveBeenCalledTimes(1);

    await middleware(reqIp, res as Response, next); // 2nd request ip (blocked)
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("distinguishes between different categories for the same user", async () => {
    const apiLimiter = rateLimiter("api", 1, DEFAULT_WINDOW_MS);
    const authLimiter = rateLimiter("auth", 1, DEFAULT_WINDOW_MS);

    await apiLimiter(req, res as Response, next); // 1st api request (ok)
    expect(next).toHaveBeenCalledTimes(1);

    await authLimiter(req, res as Response, next); // 1st auth request (ok)
    expect(next).toHaveBeenCalledTimes(2);

    await apiLimiter(req, res as Response, next); // 2nd api request (blocked)
    expect(res.status).toHaveBeenCalledWith(429);
  });
});

describe("calculateStreak", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 for empty set", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(calculateStreak(new Set())).toBe(0);
  });

  it("returns 1 when only today is completed", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(calculateStreak(new Set(["2026-01-15"]))).toBe(1);
  });

  it("returns 1 when only yesterday is completed", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(calculateStreak(new Set(["2026-01-14"]))).toBe(1);
  });

  it("returns 2 when today and yesterday are completed", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(calculateStreak(new Set(["2026-01-14", "2026-01-15"]))).toBe(2);
  });

  it("returns 0 when neither today nor yesterday is completed", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(calculateStreak(new Set(["2026-01-13"]))).toBe(0);
  });

  it("stops at gaps (today + 2 days ago = streak of 1)", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(calculateStreak(new Set(["2026-01-15", "2026-01-13"]))).toBe(1);
  });

  it("counts long consecutive streaks", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    const dates = new Set([
      "2026-01-15",
      "2026-01-14",
      "2026-01-13",
      "2026-01-12",
      "2026-01-11",
    ]);
    expect(calculateStreak(dates)).toBe(5);
  });

  it("streak from yesterday counts backwards correctly", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    const dates = new Set(["2026-01-14", "2026-01-13", "2026-01-12"]);
    expect(calculateStreak(dates)).toBe(3);
  });

  it("counts across leap year boundary (Feb 29 to Mar 1)", () => {
    vi.setSystemTime(new Date("2024-03-02T12:00:00Z"));
    const dates = new Set(["2024-03-02", "2024-03-01", "2024-02-29", "2024-02-28"]);
    expect(calculateStreak(dates)).toBe(4);
  });

  it("counts across non-leap year boundary (Feb 28 to Mar 1)", () => {
    vi.setSystemTime(new Date("2025-03-02T12:00:00Z"));
    const dates = new Set(["2025-03-02", "2025-03-01", "2025-02-28", "2025-02-27"]);
    expect(calculateStreak(dates)).toBe(4);
  });

  it("counts across year boundary (Dec 31 to Jan 1)", () => {
    vi.setSystemTime(new Date("2026-01-02T12:00:00Z"));
    const dates = new Set(["2026-01-02", "2026-01-01", "2025-12-31", "2025-12-30"]);
    expect(calculateStreak(dates)).toBe(4);
  });

  it("ignores future dates", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    const dates = new Set(["2026-01-16", "2026-01-15", "2026-01-14"]);
    expect(calculateStreak(dates)).toBe(2);
  });

  it("single old date far in the past returns 0", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(calculateStreak(new Set(["2025-01-01"]))).toBe(0);
  });

  it("returns 0 if today is completed but it is the only one and not today or yesterday", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(calculateStreak(new Set(["2026-01-10", "2026-01-09"]))).toBe(0);
  });
});

describe("expandExercisesToSetRows", () => {
  it("expands exercise with sets array", () => {
    const exercises = [
      {
        exerciseName: "back_squat",
        category: "strength",
        customLabel: null,
        confidence: 95,
        sets: [
          { setNumber: 1, reps: 8, weight: 100 },
          { setNumber: 2, reps: 8, weight: 100 },
        ],
      },
    ];
    const rows = expandExercisesToSetRows(exercises, "workout-1");
    expect(rows).toHaveLength(2);
    expect(rows[0].workoutLogId).toBe("workout-1");
    expect(rows[0].exerciseName).toBe("back_squat");
    expect(rows[0].setNumber).toBe(1);
    expect(rows[0].reps).toBe(8);
    expect(rows[0].weight).toBe(100);
    expect(rows[0].confidence).toBe(95);
    expect(rows[0].sortOrder).toBe(0);
    expect(rows[1].sortOrder).toBe(1);
  });

  it("uses numSets when no sets array is provided", () => {
    const exercises = [
      {
        exerciseName: "bench_press",
        category: "strength",
        numSets: 3,
        reps: 10,
        weight: 60,
      },
    ];
    const rows = expandExercisesToSetRows(exercises, "workout-1");
    expect(rows).toHaveLength(3);
    expect(rows[0].setNumber).toBe(1);
    expect(rows[1].setNumber).toBe(2);
    expect(rows[2].setNumber).toBe(3);
    expect(rows.every((r) => r.reps === 10 && r.weight === 60)).toBe(true);
  });

  it("defaults to 1 set when no sets array and no numSets", () => {
    const exercises = [
      { exerciseName: "pull_up", category: "strength", reps: 10 },
    ];
    const rows = expandExercisesToSetRows(exercises, "workout-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].setNumber).toBe(1);
  });

  it("propagates customLabel", () => {
    const exercises = [
      {
        exerciseName: "custom",
        category: "conditioning",
        customLabel: "Turkish Getup",
        sets: [{ setNumber: 1, reps: 5, weight: 24 }],
      },
    ];
    const rows = expandExercisesToSetRows(exercises, "workout-1");
    expect(rows[0].customLabel).toBe("Turkish Getup");
  });

  it("increments sortOrder across multiple exercises", () => {
    const exercises = [
      {
        exerciseName: "back_squat",
        category: "strength",
        sets: [{ setNumber: 1, reps: 5 }],
      },
      {
        exerciseName: "bench_press",
        category: "strength",
        sets: [
          { setNumber: 1, reps: 8 },
          { setNumber: 2, reps: 8 },
        ],
      },
    ];
    const rows = expandExercisesToSetRows(exercises, "workout-1");
    expect(rows).toHaveLength(3);
    expect(rows[0].sortOrder).toBe(0);
    expect(rows[1].sortOrder).toBe(1);
    expect(rows[2].sortOrder).toBe(2);
  });

  it("returns empty array for exercise with empty sets array", () => {
    const exercises = [
      {
        exerciseName: "back_squat",
        category: "strength",
        sets: [],
      },
    ];
    const rows = expandExercisesToSetRows(exercises, "workout-1");
    expect(rows).toHaveLength(0);
  });

  it("handles null/undefined values with nullish coalescing", () => {
    const exercises = [
      {
        exerciseName: "easy_run",
        category: "running",
        sets: [{ setNumber: 1, time: 30 }],
      },
    ];
    const rows = expandExercisesToSetRows(exercises, "workout-1");
    expect(rows[0].reps).toBeNull();
    expect(rows[0].weight).toBeNull();
    expect(rows[0].distance).toBeNull();
    expect(rows[0].time).toBe(30);
  });
});
