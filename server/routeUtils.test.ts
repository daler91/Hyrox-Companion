import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Mock express-rate-limit with a lightweight, synchronous in-process store.
// This lets us test that our rateLimiter() wrapper correctly:
//   - forwards per-user keys (namespaced by category)
//   - returns 429 + Retry-After when the limit is exceeded
//   - bypasses when no identifier is present
//   - isolates limits across categories and users
// ---------------------------------------------------------------------------
vi.mock("express-rate-limit", () => {
  const store = new Map<string, { count: number; resetAt: number }>();

  interface RateLimitOptions {
    windowMs?: number;
    max?: number;
    keyGenerator?: (req: Record<string, unknown>) => string;
    skip?: (req: Record<string, unknown>) => boolean;
    handler?: (req: Record<string, unknown>, res: Record<string, unknown>) => void;
  }

  const mockRateLimit = vi.fn((opts: RateLimitOptions) => {
    const windowMs = opts.windowMs ?? 60000;
    const max = opts.max ?? 1;
    const keyGen = opts.keyGenerator;
    const skip = opts.skip;
    const handler = opts.handler;

    return (req: Record<string, unknown>, res: Record<string, unknown>, next: NextFunction) => {
      if (skip?.(req)) return next();

      const key = keyGen ? keyGen(req) : req.ip ?? "";
      if (!key) return next();

      const now = Date.now();
      const bucket = store.get(key);

      if (!bucket || now >= bucket.resetAt) {
        store.set(key, { count: 1, resetAt: now + windowMs });
        return next();
      }

      if (bucket.count >= max) {
        const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
        res.setHeader("Retry-After", String(retryAfterSec));
        if (handler) {
          handler(req, res);
        } else {
          res.status(429).json({ error: "Too many requests" });
        }
        return;
      }

      bucket.count++;
      return next();
    };
  });

  // Expose store reset for beforeEach hooks
  (mockRateLimit as unknown as { __resetStore: () => void }).__resetStore = () => store.clear();

  return { 
    default: mockRateLimit,
    MemoryStore: class { public isMock = true; }
  };
});

import { calculateStreak, rateLimiter, clearRateLimitBuckets, validateBody, DEFAULT_WINDOW_MS } from "./routeUtils";
import { expandExercisesToSetRows } from "./services/workoutService";
import rateLimit from "express-rate-limit";

describe("rateLimiter", () => {
  let req: { auth: { userId: string }; ip: string };
  let res: {
    setHeader: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  let next: NextFunction;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));

    // Clear both the limiter cache and the mock store
    clearRateLimitBuckets();
    (rateLimit as unknown as { __resetStore?: () => void }).__resetStore?.();

    req = {
      auth: { userId: "user123" },
      ip: "192.168.1.1",
    };

    res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    next = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls next() for requests under the limit", () => {
    const middleware = rateLimiter("api", 2, DEFAULT_WINDOW_MS);

    middleware(req, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();

    middleware(req, res as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 429 when maxRequests is exceeded", () => {
    const middleware = rateLimiter("api", 2, DEFAULT_WINDOW_MS);

    middleware(req, res as Response, next); // 1st request (ok)
    middleware(req, res as Response, next); // 2nd request (ok)
    middleware(req, res as Response, next); // 3rd request (blocked)

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("Too many requests") }),
    );
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", expect.any(String));
  });

  it("resets limit after windowMs passes", () => {
    const middleware = rateLimiter("api", 1, DEFAULT_WINDOW_MS);

    middleware(req, res as Response, next); // 1st request (ok)
    expect(next).toHaveBeenCalledTimes(1);

    middleware(req, res as Response, next); // 2nd request (blocked)
    expect(res.status).toHaveBeenCalledWith(429);

    // Advance time past the window
    vi.advanceTimersByTime(DEFAULT_WINDOW_MS);

    middleware(req, res as Response, next); // 3rd request (ok again)
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("distinguishes between different users", () => {
    const middleware = rateLimiter("api", 1, DEFAULT_WINDOW_MS);

    // User 1 requests
    middleware(req, res as Response, next); // 1st request user1 (ok)
    expect(next).toHaveBeenCalledTimes(1);

    // User 2 requests
    const req2 = { ...req, auth: { userId: "user456" } };
    middleware(req2, res as Response, next); // 1st request user2 (ok)
    expect(next).toHaveBeenCalledTimes(2);

    // User 1 requests again (blocked)
    middleware(req, res as Response, next); // 2nd request user1 (blocked)
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("uses ip address if userId is missing", () => {
    const middleware = rateLimiter("api", 1, DEFAULT_WINDOW_MS);
    const reqIp = { ip: "10.0.0.1" };

    middleware(reqIp as Request, res as Response, next); // 1st request ip (ok)
    expect(next).toHaveBeenCalledTimes(1);

    middleware(reqIp as Request, res as Response, next); // 2nd request ip (blocked)
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("calls next() and bypasses rate limiting if neither userId nor ip is present", () => {
    const middleware = rateLimiter("api", 1, DEFAULT_WINDOW_MS);
    const reqEmpty = {};

    middleware(reqEmpty as Request, res as Response, next); // 1st request empty (ok)
    middleware(reqEmpty as Request, res as Response, next); // 2nd request empty (ok)

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("distinguishes between different categories for the same user", () => {
    const apiLimiter = rateLimiter("api", 1, DEFAULT_WINDOW_MS);
    const authLimiter = rateLimiter("auth", 1, DEFAULT_WINDOW_MS);

    apiLimiter(req, res as Response, next); // 1st api request (ok)
    expect(next).toHaveBeenCalledTimes(1);

    authLimiter(req, res as Response, next); // 1st auth request (ok — different category)
    expect(next).toHaveBeenCalledTimes(2);

    apiLimiter(req, res as Response, next); // 2nd api request (blocked)
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


  it("maintains streak when run at 11:59 PM", () => {
    vi.setSystemTime(new Date("2026-01-15T23:59:59.999Z"));
    expect(calculateStreak(new Set(["2026-01-15", "2026-01-14"]))).toBe(2);
  });

  it("calculates correctly when run at 00:00 AM (midnight)", () => {
    vi.setSystemTime(new Date("2026-01-16T00:00:00.000Z"));
    // If it's the 16th midnight, the 15th was yesterday. Streak should continue.
    expect(calculateStreak(new Set(["2026-01-15", "2026-01-14"]))).toBe(2);
  });

  it("handles a single gap of 1 day correctly (streak broken)", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    // Today is 15th, completed 15th and 13th. 14th is missing.
    // So streak should be 1.
    expect(calculateStreak(new Set(["2026-01-15", "2026-01-13", "2026-01-12"]))).toBe(1);
  });

  it("streak from yesterday ignores earlier gaps", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    // Today is 15th. Completed 14th, 13th, 11th. Missing 12th.
    // Streak from yesterday is 2.
    expect(calculateStreak(new Set(["2026-01-14", "2026-01-13", "2026-01-11"]))).toBe(2);
  });

  it("ignores completely unrelated string formats or invalid dates safely", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    const dates = new Set(["2026-01-15", "hello", "2026/01/14", "2026-01-13"]);
    // Since "2026-01-14" is not correctly formatted as "YYYY-MM-DD" in the set, it breaks the streak.
    // "2026-01-15" is found, so streak is 1. The next expected is "2026-01-14", which is missing (only "2026/01/14" is there).
    expect(calculateStreak(dates)).toBe(1);
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




describe("validateBody", () => {
  const schema = z.object({
    name: z.string(),
    age: z.number().optional(),
  });

  it("should call next() and update req.body on valid input", () => {
    const req = { body: { name: "Test", age: 30 } } as any;
    const res = {} as any;
    const next = vi.fn();

    const middleware = validateBody(schema);
    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body).toEqual({ name: "Test", age: 30 });
  });

  it("should strip unknown properties from req.body on valid input", () => {
    const req = { body: { name: "Test", unknownProp: true } } as any;
    const res = {} as any;
    const next = vi.fn();

    const middleware = validateBody(schema);
    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body).toEqual({ name: "Test" });
  });

  it("should return 400 on invalid input without calling next()", () => {
    const req = { body: { age: "not a number" } } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    const middleware = validateBody(schema);
    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Required",
        details: expect.any(Object),
      })
    );
  });
});
