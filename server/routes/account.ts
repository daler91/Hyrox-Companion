import { type Request as ExpressRequest, type Response, Router } from "express";

import { rateLimiter, sendNotFound } from "../routeUtils";
import { eraseAccount } from "../services/accountErasureService";
import { getUserId } from "../types";
import { protectedDelete } from "./_helpers/protectedRouteBuilder";

const router = Router();

/**
 * DELETE /api/v1/account
 *
 * Permanently deletes the authenticated user's account and all associated
 * data. FK cascades on the `users` table handle child row cleanup for:
 * workout_logs, exercise_sets, training_plans, plan_days, chat_messages,
 * coaching_materials, strava_connections, garmin_connections,
 * custom_exercises, push_subscriptions, ai_usage_logs, idempotency_keys,
 * and timeline_annotations.
 *
 * Two stores need explicit handling beyond the cascade:
 * - `document_chunks` and `food_embeddings` live on the SEPARATE vector
 *   database (`vectorPool`), which the main-DB FK cascade cannot reach.
 * - The user's PRIVATE custom foods: `foods.created_by_user_id` is set-null
 *   on user delete (RESTRICT FKs from log entries/recipes would otherwise
 *   block the delete), so without an explicit purge those rows would linger
 *   ownerless. PUBLIC custom foods (is_public) survive by design — sharing
 *   was an explicit, disclosed opt-in.
 *
 * The steps themselves live in accountErasureService, because the erasure
 * has to be resumable: it deletes the Clerk identity partway through, and
 * from that moment the athlete can no longer authenticate to retry. A run
 * that fails after that point leaves `users.erasure_requested_at` stamped,
 * and the erasure sweep in server/cron.ts finishes it.
 */
protectedDelete(router, "/api/v1/account", { limiter: rateLimiter("accountDelete", 3) }, async (req: ExpressRequest, res: Response) => {
    const { deleted } = await eraseAccount(getUserId(req), req.log);
    if (!deleted) {
      return sendNotFound(res, "User not found");
    }
    res.json({ success: true });
  });

export default router;
