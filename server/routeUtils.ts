import type { NextFunction,Request, Response } from "express";
import rateLimit, { MemoryStore } from "express-rate-limit";

import { DEFAULT_RATE_LIMIT_WINDOW_MS, MS_PER_DAY } from "./constants";
import { ErrorCode } from "./errors";
import { logger } from "./logger";
import { toDateStr } from "./types";

export const DEFAULT_WINDOW_MS = DEFAULT_RATE_LIMIT_WINDOW_MS;

interface AuthenticatedRequest extends Request {
  auth?: { userId?: string };
}

// One limiter instance per unique (category, maxRequests, windowMs) combination.
// This preserves the per-category isolation of the previous Map-based design.
//
// Limitation: MemoryStore is memory-backed, resets on restart, and is per-instance.
// This is acceptable for our single-instance Railway deployment.
// If scaling to multiple instances, swap to `rate-limit-redis` for shared state.
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
          // Explicit user:/ip: prefixes prevent collision between a userId that
          // happens to equal a client IP (CODEBASE_AUDIT.md §2).
          keyGenerator: (req: Request) => {
            const authReq = req as AuthenticatedRequest;
            if (authReq.auth?.userId) return `${category}:user:${authReq.auth.userId}`;
            if (req.ip) return `${category}:ip:${req.ip}`;
            return "";
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
              code: "RATE_LIMITED",
            });
          },
        }),
      );
    }

    const limiter = limiterCache.get(cacheKey);
    if (!limiter) throw new Error(`Rate limiter not found for ${category}`);
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

  const yesterday = new Date(today.getTime() - MS_PER_DAY);
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

/** Project safe validation issues from a Zod error — never leak raw internals. */
export function formatValidationErrors(error: z.ZodError): { issues: Array<{ path: string; message: string }> } {
  return {
    issues: error.issues.map((e) => ({
      path: e.path.join("."),
      message: e.message,
    })),
  };
}

export function validateBody(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const errorMessage = parsed.error.issues[0]?.message || "Invalid request data";
      res.status(400).json({ error: errorMessage, code: "VALIDATION_ERROR", details: formatValidationErrors(parsed.error) });
      return;
    }
    req.body = parsed.data;
    next();
  };
}

export const asyncHandler = <Req extends Request>(fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction): void => {
  Promise.resolve(fn(req as Req, res, next)).catch((err) => {
    const log = req.log ?? logger;
    log.error({ err }, `Route error in ${req.method} ${req.originalUrl}`);
    next(err);
  });
};

/**
 * Uniform 404 response for handlers that resolve "not found" by returning a
 * falsy value from storage. Keeps the `{ error, code: "NOT_FOUND" }` contract
 * consistent across every route so clients can branch on `code` reliably.
 */
export function sendNotFound(res: Response, message: string): Response {
  return res.status(404).json({ error: message, code: ErrorCode.NOT_FOUND });
}

export interface ParsedPagination {
  readonly limit: number;
  readonly offset: number | undefined;
}

/**
 * Parse `?limit` and `?offset` query params. On an invalid value, writes the
 * 400 response and returns null so the caller can early-return. When
 * `maxLimit` is provided, values above it produce a 412 PRECONDITION_FAILED
 * rather than a silent clamp — matches the behaviour previously hand-coded
 * in `/api/v1/workouts`.
 */
export function parsePagination(
  query: { limit?: string; offset?: string },
  res: Response,
  options: { defaultLimit: number; maxLimit?: number },
): ParsedPagination | null {
  const rawLimit = query.limit ? Number.parseInt(query.limit, 10) : options.defaultLimit;
  const offset = query.offset ? Number.parseInt(query.offset, 10) : undefined;

  if (Number.isNaN(rawLimit) || rawLimit < 1) {
    res.status(400).json({ error: "Invalid limit", code: "BAD_REQUEST" });
    return null;
  }
  if (offset !== undefined && (Number.isNaN(offset) || offset < 0)) {
    res.status(400).json({ error: "Invalid offset", code: "BAD_REQUEST" });
    return null;
  }
  if (options.maxLimit !== undefined && rawLimit > options.maxLimit) {
    res.status(412).json({
      error: `limit exceeds maximum of ${options.maxLimit}`,
      code: "PRECONDITION_FAILED",
      maxLimit: options.maxLimit,
    });
    return null;
  }

  return { limit: rawLimit, offset };
}
