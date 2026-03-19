import rateLimit from "express-rate-limit";
import type { Response, NextFunction } from "express";
import { toDateStr } from "./types";


import { MemoryStore } from "express-rate-limit";

export const DEFAULT_WINDOW_MS = 60000;

const categoryStores = new Map<string, MemoryStore>();

function getStoreForCategory(category: string): MemoryStore {
  if (!categoryStores.has(category)) {
    categoryStores.set(category, new MemoryStore());
  }
  return categoryStores.get(category)!;
}


export function clearRateLimitBuckets() {
  categoryStores.clear();
}

export function rateLimiter(category: string, maxRequests: number, windowMs: number = DEFAULT_WINDOW_MS) {
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    validate: { keyGeneratorIpFallback: false, unsharedStore: false },
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
    store: getStoreForCategory(category),
    skip: (req: any) => !req.auth?.userId && !req.ip,
    keyGenerator: (req: any) => `${category}:${req.auth?.userId || req.ip}`,
  });
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
