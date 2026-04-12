import { clerkClient } from "@clerk/express";
import { type Request as ExpressRequest, type Response, Router } from "express";

import { isAuthenticated } from "../clerkAuth";
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
 * Also attempts to deauthorize the Strava connection (if any) and delete
 * the Clerk user record.
 */
router.delete(
  "/api/v1/account",
  isAuthenticated,
  rateLimiter("accountDelete", 3),
  asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);

    // Best-effort Strava deauthorization before deleting the DB record
    // (which cascades and removes the stored token).
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

    // Delete the user row — all child rows cascade.
    const deleted = await storage.users.deleteUser(userId);
    if (!deleted) {
      return res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
    }

    // Best-effort Clerk user deletion. If Clerk keys are not configured
    // (dev bypass mode), skip this step.
    if (env.CLERK_SECRET_KEY) {
      try {
        await clerkClient.users.deleteUser(userId);
      } catch (err) {
        logger.warn({ err, userId }, "Clerk user deletion failed during account deletion");
      }
    }

    res.json({ success: true });
  }),
);

export default router;
