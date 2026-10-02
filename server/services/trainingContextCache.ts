import type { NextFunction, Request, Response } from "express";

import { TRAINING_CONTEXT_CACHE_TTL_MS } from "../constants";
import type { TrainingContext } from "../gemini/types";
import { storage } from "../storage";
import { getLocalDateStrSafe } from "../timezone";
import { getUserId } from "../types";

/**
 * The coach chat's training context, kept per athlete for a few minutes (AI
 * coach chat review, I12). Building it is the heaviest read on a chat turn —
 * about eight queries, 70 days of sets among them — and a conversation used
 * to pay it again on every message.
 *
 * Only the chat reads through here. The auto-coach, workout suggestions and
 * coach insights still build their own: they run straight after a write and
 * must see it.
 *
 * An entry is dropped:
 * - after any successful write request by the athlete outside the chat
 *   ({@link invalidateTrainingContextOnWrite}), which covers logging, plan
 *   edits, settings, nutrition and proposals;
 * - after any background job for the athlete finishes (server/queue.ts
 *   runBatch): the auto-coach, device syncs, plan generation;
 * - when a plan proposal is applied or undone, since the chat stream can
 *   auto-apply one;
 * - at the athlete's local midnight, because the date is in the key: "today"
 *   is part of the context;
 * - after {@link TRAINING_CONTEXT_CACHE_TTL_MS} regardless.
 *
 * In process only, like the analytics cache: with more than one instance,
 * the others keep their copy until the TTL, which is the backstop.
 *
 * Callers share one object, so they must treat it as read-only; the prompt
 * builders already copy before sorting.
 */

const MAX_ENTRIES = 500;

interface Entry {
  readonly promise: Promise<TrainingContext>;
  readonly createdAt: number;
}

/** Keyed `${userId}|${athlete-local date}`. */
const entries = new Map<string, Entry>();

function dropExpired(now: number): void {
  for (const [key, entry] of entries) {
    if (now - entry.createdAt >= TRAINING_CONTEXT_CACHE_TTL_MS) entries.delete(key);
  }
  // Maps iterate in insertion order, so the first keys are the oldest.
  for (const key of entries.keys()) {
    if (entries.size <= MAX_ENTRIES) break;
    entries.delete(key);
  }
}

/**
 * The athlete's training context, from the cache while it is fresh. Concurrent
 * callers share one build; a failed build is not kept.
 */
export async function getCachedTrainingContext(
  userId: string,
  build: (userId: string) => Promise<TrainingContext>,
): Promise<TrainingContext> {
  const user = await storage.users.getUser(userId);
  const now = Date.now();
  const key = `${userId}|${getLocalDateStrSafe(new Date(now), user?.userTimezone)}`;
  const cached = entries.get(key);
  if (cached && now - cached.createdAt < TRAINING_CONTEXT_CACHE_TTL_MS) return cached.promise;

  const promise = build(userId);
  entries.set(key, { promise, createdAt: now });
  dropExpired(now);
  promise.catch(() => {
    if (entries.get(key)?.promise === promise) entries.delete(key);
  });
  return promise;
}

/**
 * Drop the athlete's cached context. A build already under way still answers
 * the request that started it, but is no longer handed to anyone else.
 */
export function invalidateTrainingContext(userId: string): void {
  const prefix = `${userId}|`;
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Sending and saving chat turns, and clearing them, change nothing the context reads. */
function isChatPath(path: string): boolean {
  return path === "/chat" || path.startsWith("/chat/");
}

/**
 * Mounted on /api/v1: a successful write by the athlete drops their cached
 * context once the response is sent.
 */
export function invalidateTrainingContextOnWrite(req: Request, res: Response, next: NextFunction): void {
  if (!WRITE_METHODS.has(req.method) || isChatPath(req.path)) {
    next();
    return;
  }
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    let userId: string;
    try {
      userId = getUserId(req);
    } catch {
      return;
    }
    invalidateTrainingContext(userId);
  });
  next();
}

/** For tests: forget every entry. */
export function clearTrainingContextCache(): void {
  entries.clear();
}
