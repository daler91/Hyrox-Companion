import { clerkClient } from "@clerk/express";
import { type Request as ExpressRequest, type Response, Router } from "express";

import { evictUserFromSeenCache, isAuthenticated } from "../clerkAuth";
import { env } from "../env";
import { logger } from "../logger";
import { asyncHandler, rateLimiter } from "../routeUtils";
import { storage } from "../storage";
import { getUserId } from "../types";

const router = Router();

/**
 * DELETE /api/v1/account
 *
 * Permanently deletes the authenticated user's account and all associated
 * data. FK cascades on the `users` table handle child row cleanup for:
 * workout_logs, exercise_sets, training_plans, plan_days, chat_messages,
 * coaching_materials, document_chunks, strava_connections,
 * garmin_connections, custom_exercises, push_subscriptions,
 * ai_usage_logs, idempotency_keys, and timeline_annotations.
 *
 * Order of operations:
 * 1. Delete Clerk identity first (hard fail if this fails, since
 *    ensureUserExists would re-provision the DB row on next request).
 * 2. Best-effort Strava deauthorization.
 * 3. Delete DB user row (cascades all child rows).
 * 4. Evict user from auth seen-cache to prevent stale session use.
 */
router.delete(
  "/api/v1/account",
  isAuthenticated,
  rateLimiter("accountDelete", 3),
  asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);

    // Step 1: Delete Clerk identity first. If this fails the DB row must
    // stay intact — otherwise ensureUserExists re-creates it on the next
    // authenticated request, silently "undeleting" the account.
    // A 404 from Clerk means the identity was already removed (e.g. a
    // previous attempt succeeded at Clerk but failed at the DB step), so
    // treat it as success to keep the operation idempotent.
    if (env.CLERK_SECRET_KEY) {
      try {
        await clerkClient.users.deleteUser(userId);
      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        if (status !== 404) throw err;
        logger.info({ userId }, "Clerk user already deleted, continuing with DB cleanup");
      }
    }

    // Step 2: Best-effort Strava deauthorization before deleting the DB
    // record (which cascades and removes the stored token).
    try {
      const stravaConn = await storage.users.getStravaConnection(userId);
      if (stravaConn) {
        await fetch("https://www.strava.com/oauth/deauthorize", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `access_token=${stravaConn.accessToken}`,
        });
      }
    } catch (err) {
      // Non-fatal — the user's data will still be deleted.
      logger.warn({ err, userId }, "Strava deauthorization failed during account deletion");
    }

    // Step 3: Delete the user row — all child rows cascade.
    const deleted = await storage.users.deleteUser(userId);
    if (!deleted) {
      return res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
    }

    // Step 4: Evict from the auth seen-cache so stale sessions can't
    // trigger ensureUserExists within the 5-minute TTL window.
    evictUserFromSeenCache(userId);

    res.json({ success: true });
  }),
);

export default router;
