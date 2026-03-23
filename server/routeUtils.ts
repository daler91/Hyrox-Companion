import { logger } from "./logger";
import { toDateStr } from "./types";
import rateLimit, { MemoryStore } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";

export const DEFAULT_WINDOW_MS = 60000;

interface AuthenticatedRequest extends Request {
  auth?: { userId?: string };
}

// One limiter instance per unique (category, maxRequests, windowMs) combination.
// This preserves the per-category isolation of the previous Map-based design.
const limiterCache = new Map<string, ReturnType<typeof rateLimit>>();

export function rateLimiter(
  category: string,
  maxRequests: number,
  windowMs: number = DEFAULT_WINDOW_MS,
) {
  const retryAfterSec = Math.ceil(windowMs / 1000);
  const cacheKey = `${category}:${maxRequests}:${windowMs}`;

  // Return a wrapper closure so that the limiter is evaluated at request time.
  // This is crucial for test environments where `clearRateLimitBuckets` is called:
  // routers capture this wrapper at module load, but the inner rateLimit instance
  // can be destroyed and recreated cleanly.
  return (req: Request, res: Response, next: NextFunction) => {
    if (!limiterCache.has(cacheKey)) {
      limiterCache.set(
        cacheKey,
        rateLimit({
          windowMs,
          max: maxRequests,
          store: new MemoryStore(), // Explicitly give each limiter its own store so caching clears reset state
          validate: { default: false }, // Suppress dynamic creation warning since we use it intentionally for tests
          // Per-user key, namespaced by category so limits are independent per route group.
          keyGenerator: (req: Request) => {
            const authReq = req as AuthenticatedRequest;
            const id = authReq.auth?.userId ?? req.ip;
            return id ? `${category}:${id}` : "";
          },
          // Skip rate-limiting entirely when there is no identifier.
          skip: (req: Request) => {
            const authReq = req as AuthenticatedRequest;
            return !authReq.auth?.userId && !req.ip;
          },
          standardHeaders: true,   // RateLimit-* headers (RFC 6585)
          legacyHeaders: false,     // Disable X-RateLimit-* headers
          handler: (_req: Request, res: Response) => {
            res.setHeader("Retry-After", String(retryAfterSec));
            res.status(429).json({
              error: `Too many requests. Please wait ${retryAfterSec} seconds before trying again.`,
            });
          },
        }),
      );
    }

    const limiter = limiterCache.get(cacheKey)!;
    return limiter(req, res, next);
  };
}


// Exported for testing only — clears the limiter cache so each test starts fresh.
export function clearRateLimitBuckets() {
  limiterCache.clear();
}

export function calculateStreak(completedDates: Set<string>): number {
  if (completedDates.size === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toDateStr(today);

  const yesterday = new Date(today.getTime() - 86400000);
  const yesterdayStr = toDateStr(yesterday);

  if (!completedDates.has(todayStr) && !completedDates.has(yesterdayStr)) return 0;

  let streak = 0;
  const checkDate = completedDates.has(todayStr) ? new Date(today) : new Date(yesterday);

  while (true) {
    const dateStr = toDateStr(checkDate);
    if (completedDates.has(dateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}


import { z } from "zod";

export function validateBody(schema: z.ZodType<any, any, any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const errorMessage = parsed.error.errors[0]?.message || "Invalid request data";
      res.status(400).json({ error: errorMessage, details: parsed.error });
      return;
    }
    req.body = parsed.data;
    next();
  };
}

export const asyncHandler = (fn: (req: any, res: Response, next: NextFunction) => Promise<any>) => (req: Request, res: Response, next: NextFunction) => {
  return Promise.resolve(fn(req, res, next)).catch((err) => {
    const log = (req as any).log || logger;
    log.error({ err }, `Route error in ${req.method} ${req.originalUrl}`);
    next(err);
  });
};
