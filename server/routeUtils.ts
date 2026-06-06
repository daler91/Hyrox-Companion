import type { NextFunction,Request, Response } from "express";
import rateLimit, { MemoryStore } from "express-rate-limit";

import { DEFAULT_RATE_LIMIT_WINDOW_MS, MS_PER_DAY } from "./constants";
import { env } from "./env";
import { ErrorCode } from "./errors";
import { logger } from "./logger";
import { PostgresRateLimitStore } from "./rateLimitStore";
import { toDateStr } from "./types";

export const DEFAULT_WINDOW_MS = DEFAULT_RATE_LIMIT_WINDOW_MS;

interface AuthenticatedRequest extends Request {
  auth?: { userId?: string };
}

// One limiter instance per unique (category, maxRequests, windowMs) combination.
// This preserves the per-category isolation of the previous Map-based design.
const limiterCache = new Map<string, ReturnType<typeof rateLimit>>();

function createRateLimitStore(category: string, windowMs: number) {
  if (env.NODE_ENV === "test") {
    return new MemoryStore();
  }
  return new PostgresRateLimitStore(category, windowMs);
}

// Reads (safe HTTP methods) fail OPEN if the Postgres rate-limit store errors,
// so a transient store/DB blip can't 500 the read surface; everything else —
// mutations, and therefore all auth / AI-spend / write routes — fails CLOSED,
// where allowing unbounded requests during a store outage is the bigger risk.
// The limiter is selected per request by method (W6). Counts stay unified per
// category because both instances share the same Postgres store key.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function buildLimiter(category: string, maxRequests: number, windowMs: number, failOpen: boolean) {
  const retryAfterSec = Math.ceil(windowMs / 1000);
  return rateLimit({
    windowMs,
    max: maxRequests,
    store: createRateLimitStore(category, windowMs),
    passOnStoreError: failOpen,
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
  });
}

export function rateLimiter(
  category: string,
  maxRequests: number,
  windowMs: number = DEFAULT_WINDOW_MS,
) {
  // Return a wrapper closure so the limiter is evaluated at request time. This
  // is crucial for tests (where `clearRateLimitBuckets` recreates instances)
  // and lets us pick the fail-open vs fail-closed limiter per request method.
  return (req: Request, res: Response, next: NextFunction) => {
    const failOpen = SAFE_METHODS.has(req.method);
    const cacheKey = `${category}:${maxRequests}:${windowMs}:${failOpen ? "open" : "closed"}`;
    if (!limiterCache.has(cacheKey)) {
      limiterCache.set(cacheKey, buildLimiter(category, maxRequests, windowMs, failOpen));
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

/**
 * Validation error contract used by all Zod-based route middleware.
 *
 * Response shape (HTTP 400):
 * `{ code: "VALIDATION_ERROR", message: string, details: { issues: [{ path, message }] } }`
 */
export interface ValidationErrorResponse {
  code: "VALIDATION_ERROR";
  message: string;
  details: { issues: Array<{ path: string; message: string }> };
}

/** Project safe validation issues from a Zod error — never leak raw internals. */
export function formatValidationErrors(error: z.ZodError): ValidationErrorResponse["details"] {
  return {
    issues: error.issues.map((e) => ({
      path: e.path.join("."),
      message: e.message,
    })),
  };
}

function sendValidationError(res: Response, error: z.ZodError): void {
  const message = error.issues[0]?.message || "Invalid request data";
  const payload: ValidationErrorResponse = {
    code: "VALIDATION_ERROR",
    message,
    details: formatValidationErrors(error),
  };
  res.status(400).json(payload);
}

function makeValidator<T>(schema: z.ZodType<T>, picker: (req: Request) => unknown, writer: (req: Request, value: T) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(picker(req));
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    writer(req, parsed.data);
    next();
  };
}

// Express 5 exposes `req.query` as a getter-only property on the request
// prototype, so a plain assignment (`req.query = parsed`) throws
// "Cannot set property query of #<IncomingMessage> which has only a getter".
// Define an own data property to shadow the accessor instead — this keeps the
// Zod-coerced value visible to downstream handlers and stays correct for the
// `body`/`params` properties (and under Express 4) too.
function writeValidated(req: Request, key: "body" | "query" | "params", value: unknown): void {
  Object.defineProperty(req, key, { value, writable: true, enumerable: true, configurable: true });
}

export function validateBody<T>(schema: z.ZodType<T>) {
  return makeValidator(schema, (req) => req.body, (req, value) => { writeValidated(req, "body", value); });
}

export function validateQuery<T>(schema: z.ZodType<T>) {
  return makeValidator(schema, (req) => req.query, (req, value) => { writeValidated(req, "query", value); });
}

export function validateParams<T>(schema: z.ZodType<T>) {
  return makeValidator(schema, (req) => req.params, (req, value) => { writeValidated(req, "params", value); });
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
