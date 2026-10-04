import { clerkClient,clerkMiddleware, getAuth } from "@clerk/express";
import type { UpsertUser } from "@shared/schema";
import type { Express, RequestHandler } from "express";

import { EXTERNAL_API_TIMEOUT_MS } from "./constants";
import { isUniqueViolation } from "./dbErrors";
import { env } from "./env";
import { logger } from "./logger";
import { deleteRuntimeCache, getRuntimeCache, runtimeCacheKey, setRuntimeCache } from "./sharedRuntimeState";
import { storage } from "./storage";

export const DEV_USER_ID = "dev-user";

/** Thrown by ensureUserExists for a session whose account has been erased. */
class ErasedAccountError extends Error {
  constructor() {
    super("Account has been erased");
    this.name = "ErasedAccountError";
  }
}

// Clerk SDK does not accept an AbortSignal, so bound its network calls
// with Promise.race to keep auth middleware from stalling worker threads
// when Clerk's API hangs. Clear the timer once `promise` settles so we
// don't leak one pending `setTimeout` per cache-miss auth — under load
// those timers can pile up and extend the shutdown window by the full
// timeout duration.
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isDev(): boolean {
  return env.NODE_ENV === "development" || env.NODE_ENV === "test";
}

function isDevBypassEnabled(): boolean {
  // 🛡️ Sentinel: Double guard to prevent bypass in production
  if (env.NODE_ENV === "production") return false;
  return isDev() && env.ALLOW_DEV_AUTH_BYPASS === "true";
}

function hasClerkKeys(): boolean {
  return !!(env.CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY);
}

async function ensureDevUserExists(): Promise<void> {
  const existing = await storage.users.getUser(DEV_USER_ID);
  if (existing) return;
  await storage.users.upsertUser({
    id: DEV_USER_ID,
    email: "dev@localhost",
    firstName: "Dev",
    lastName: "User",
    profileImageUrl: null,
  });
}

export async function setupAuth(app: Express) {
  if (hasClerkKeys()) {
    app.use(clerkMiddleware());
  } else if (isDevBypassEnabled()) {
    logger.info("[DEV] No Clerk keys found — using dev auth bypass");
    await ensureDevUserExists();
  } else {
    throw new Error(
      "Missing Clerk environment variables. Please set CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY.",
    );
  }

  if (isDevBypassEnabled()) {
    await ensureDevUserExists();
    logger.info("[DEV] Dev auth fallback enabled for iframe/preview contexts");
  }
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (hasClerkKeys()) {
    const auth = getAuth(req);
    if (auth?.userId) {
      try {
        await ensureUserExists(auth.userId);
      } catch (error) {
        if (error instanceof ErasedAccountError) {
          return res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
        }
        logger.error({ err: error }, "Error syncing user:");
        return res.status(500).json({ error: "Failed to initialize user session", code: "INTERNAL_SERVER_ERROR" });
      }
      return next();
    }
    // Log coarse auth failure signals only. We intentionally do NOT log the
    // set of cookie key names — exposing internal cookie inventory in logs
    // widens the attack surface for anyone who can read observability
    // pipelines (CODEBASE_AUDIT.md §2, Low severity).
    logger.debug({
      path: req.path,
      hasCookie: !!req.headers.cookie,
      hasAuthHeader: !!req.headers.authorization,
      clerkUserIdPresent: !!auth?.userId,
    }, "Clerk auth failed");
  }

  if (isDevBypassEnabled() && req.headers["x-test-no-bypass"] !== "true") {
    try {
      await ensureDevUserExists();
    } catch (error) {
      logger.error({ err: error }, "Error creating dev user:");
      return res.status(500).json({ error: "Failed to initialize dev user session", code: "INTERNAL_SERVER_ERROR" });
    }
    return next();
  }

  return res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
};

const userSeenCache = new Map<string, number>();
const USER_SEEN_TTL_MS = 5 * 60_000; // 5 minutes

/**
 * How long an erased account's id is refused re-provisioning. Clerk verifies
 * session JWTs locally, so a token minted before the identity was deleted keeps
 * passing clerkMiddleware until it expires (60 s by default); ten minutes
 * comfortably outlives that plus clock skew.
 */
const ERASED_USER_TTL_MS = 10 * 60_000;
/** userId -> when its erasure tombstone lapses (epoch ms). */
const erasedUserCache = new Map<string, number>();

function userSeenCacheKey(userId: string): string {
  return runtimeCacheKey("auth-seen", userId);
}

function erasedUserCacheKey(userId: string): string {
  return runtimeCacheKey("auth-erased", userId);
}

// Exported for testing only — clears the user-seen cache (and the erasure
// tombstones) so each test starts fresh.
export function clearUserSeenCache() {
  userSeenCache.clear();
  erasedUserCache.clear();
}

/**
 * Tombstone an account that is being erased, so a still-valid Clerk session for
 * it is refused (401) instead of re-provisioned. ensureUserExists treats a
 * missing users row as a first sign-in and recreates it; without this a request
 * from another tab or device inside the token's lifetime brought back an
 * erased account, with no erasure marker for the sweep to find. eraseAccount
 * calls this before the row is deleted. Throws if the shared tombstone cannot
 * be written, so the erasure stops while it is still retriable.
 * P5 (CODEBASE_ANALYSIS_2026-10-03)
 */
export async function rememberUserErased(userId: string): Promise<void> {
  erasedUserCache.set(userId, Date.now() + ERASED_USER_TTL_MS);
  if (env.NODE_ENV !== "test") {
    await setRuntimeCache(erasedUserCacheKey(userId), { erased: true }, ERASED_USER_TTL_MS);
  }
}

async function wasUserErased(userId: string, now: number): Promise<boolean> {
  const erasedUntil = erasedUserCache.get(userId);
  if (erasedUntil !== undefined) {
    if (now < erasedUntil) return true;
    erasedUserCache.delete(userId);
  }
  if (env.NODE_ENV === "test") return false;
  // Not caught: on a read failure the caller answers 500 rather than risk
  // re-creating an erased account.
  const shared = await getRuntimeCache<{ erased: true }>(erasedUserCacheKey(userId));
  return shared !== undefined;
}

/** Evict a single user from the seen-cache (e.g. after account deletion). */
export async function evictUserFromSeenCache(userId: string): Promise<void> {
  userSeenCache.delete(userId);
  if (env.NODE_ENV !== "test") {
    await deleteRuntimeCache(userSeenCacheKey(userId)).catch((err: unknown) => {
      logger.warn({ err, userId }, "Failed to evict shared auth seen-cache entry");
    });
  }
}

async function hasUserBeenSeenRecently(userId: string, now: number): Promise<boolean> {
  const seenAt = userSeenCache.get(userId);
  if (seenAt && now - seenAt < USER_SEEN_TTL_MS) return true;

  if (env.NODE_ENV !== "test") {
    try {
      const sharedSeen = await getRuntimeCache<{ seen: true }>(userSeenCacheKey(userId));
      if (sharedSeen) {
        userSeenCache.set(userId, now);
        return true;
      }
    } catch (err) {
      logger.warn({ err, userId }, "Failed to read shared auth seen-cache; falling back to storage lookup");
    }
  }

  return false;
}

function rememberUserSeen(userId: string, now: number): void {
  userSeenCache.set(userId, now);
  if (env.NODE_ENV !== "test") {
    void setRuntimeCache(userSeenCacheKey(userId), { seen: true }, USER_SEEN_TTL_MS).catch((err: unknown) => {
      logger.warn({ err, userId }, "Failed to write shared auth seen-cache");
    });
  }
}

async function ensureUserExists(clerkUserId: string): Promise<void> {
  const now = Date.now();
  if (await hasUserBeenSeenRecently(clerkUserId, now)) return;

  const existing = await storage.users.getUser(clerkUserId);
  if (!existing) {
    if (await wasUserErased(clerkUserId, now)) throw new ErasedAccountError();
    await storage.users.upsertUser({ id: clerkUserId });
    await hydrateClerkProfile(clerkUserId);
  }

  rememberUserSeen(clerkUserId, now);
}

async function upsertClerkProfile(userData: UpsertUser): Promise<void> {
  try {
    await storage.users.upsertUser(userData);
  } catch (error) {
    if (userData.email && isUniqueViolation(error, "users_email_unique")) {
      const { email: _email, ...userDataWithoutEmail } = userData;
      logger.warn(
        { err: error, userId: userData.id },
        "Clerk profile email already belongs to another user; syncing profile without email",
      );
      await storage.users.upsertUser(userDataWithoutEmail);
      return;
    }
    throw error;
  }
}

async function hydrateClerkProfile(clerkUserId: string): Promise<void> {
  try {
    const clerkUser = await withTimeout(
      clerkClient.users.getUser(clerkUserId),
      EXTERNAL_API_TIMEOUT_MS,
      "clerkClient.users.getUser",
    );
    const email = clerkUser.primaryEmailAddress?.emailAddress ?? clerkUser.emailAddresses?.[0]?.emailAddress ?? null;

    await upsertClerkProfile({
      id: clerkUserId,
      email,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      profileImageUrl: clerkUser.imageUrl,
    });
  } catch (error) {
    logger.warn(
      { err: error, userId: clerkUserId },
      "Clerk profile sync failed after user provisioning; continuing with minimal user row",
    );
  }
}
