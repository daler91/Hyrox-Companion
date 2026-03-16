import type { Request, Response, NextFunction } from "express";
import { toDateStr } from "./types";

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
export const MAX_RATE_LIMIT_BUCKETS = 10000;
export const DEFAULT_WINDOW_MS = 60000;
export const CLEANUP_INTERVAL_MS = 120000;

// Exported for testing only
export function clearRateLimitBuckets() {
  rateLimitBuckets.clear();
}

export function rateLimiter(category: string, maxRequests: number, windowMs: number = DEFAULT_WINDOW_MS) {
  return (req: Request & { auth?: { userId?: string } }, res: Response, next: NextFunction) => {
    const identifier = req.auth?.userId || req.ip || "unknown-ip";
    const key = `${category}:${identifier}`;
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      if (rateLimitBuckets.size >= MAX_RATE_LIMIT_BUCKETS) {
        // Immediate cleanup of expired entries
        rateLimitBuckets.forEach((b, k) => {
          if (now >= b.resetAt) {
            rateLimitBuckets.delete(k);
          }
        });

        // If still at the limit, evict the oldest entry (FIFO) to protect memory
        if (rateLimitBuckets.size >= MAX_RATE_LIMIT_BUCKETS) {
          const oldestKey = rateLimitBuckets.keys().next().value;
          if (oldestKey) {
             rateLimitBuckets.delete(oldestKey);
          }
        }
      }

      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (bucket.count >= maxRequests) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        error: `Too many requests. Please wait ${retryAfterSec} seconds before trying again.`,
      });
    }

    bucket.count++;
    return next();
  };
}

setInterval(() => {
  const now = Date.now();
  rateLimitBuckets.forEach((bucket, key) => {
    if (now >= bucket.resetAt) {
      rateLimitBuckets.delete(key);
    }
  });
}, CLEANUP_INTERVAL_MS);

export function calculateStreak(completedDates: Set<string>): number {
  if (completedDates.size === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toDateStr(today);

  const yesterday = new Date(today.getTime() - 86400000);
  const yesterdayStr = toDateStr(yesterday);

  if (!completedDates.has(todayStr) && !completedDates.has(yesterdayStr)) return 0;

  let streak = 0;
  let checkDate = completedDates.has(todayStr) ? new Date(today) : new Date(yesterday);

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
