import { clerkClient } from "@clerk/express";
import { type Request as ExpressRequest, type Response, Router } from "express";

import { evictUserFromSeenCache } from "../clerkAuth";
import { env } from "../env";
import { logger } from "../logger";
import { purgeUserJobs } from "../queue";
import { rateLimiter, sendNotFound } from "../routeUtils";
import { deleteFoodEmbeddingsByFoodIds } from "../services/nutrition/foodEmbeddings";
import { storage } from "../storage";
import { deauthorizeStravaBestEffort } from "../strava";
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
 * Order of operations:
 * 0. Capture the user's private custom-food ids — MUST happen before the
 *    step-5 cascade nulls the ownership column (the only signal linking
 *    foods and their embeddings to this user).
 * 1. Purge RAG chunks AND the private foods' embeddings from the separate
 *    vector DB FIRST — fail-loud and before anything irreversible, so a
 *    vector-DB outage makes the whole request retriable rather than
 *    orphaning PII or stranding erasure. (Embeddings are a derived cache:
 *    if a later step fails, the backfill cron re-embeds still-existing
 *    foods, so deleting early is safe.)
 * 2. Delete Clerk identity (hard fail if this fails, since ensureUserExists
 *    would re-provision the DB row on next request).
 * 3. Best-effort Strava deauthorization.
 * 4. Note: Garmin upstream revocation is intentionally NOT attempted —
 *    see the comment block at the deletion step for the rationale.
 * 5. Delete DB user row + private custom foods in ONE transaction (cascades
 *    all child rows, including the encrypted Garmin credentials and OAuth
 *    tokens in garmin_connections). Then a best-effort second embeddings
 *    purge for foods created/privatized between steps 0 and 5.
 * 6. Best-effort purge of the user's pending pg-boss jobs (non-fatal).
 * 7. Evict user from auth seen-cache to prevent stale session use.
 */
protectedDelete(router, "/api/v1/account", { limiter: rateLimiter("accountDelete", 3) }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);

    // Step 0: Capture the user's private custom-food ids while the ownership
    // column still exists (step 5's cascade set-nulls created_by_user_id, and
    // food_embeddings has no user column — this list is the only bridge).
    const privateFoodIds = await storage.nutrition.listPrivateCustomFoodIds(userId);

    // Step 1: Purge the user's RAG chunks AND their private foods' embeddings
    // from the SEPARATE vector DB FIRST, before any irreversible action. Both
    // live on `vectorPool` (a separate Postgres instance in production), so
    // the main-DB FK cascade in step 5 cannot reach them — without this the
    // user's uploaded coaching-material text and custom-food-name embeddings
    // are orphaned (GDPR Art. 17). Ordering them first is deliberate: both are
    // fail-loud, so if the vector DB is unreachable the request fails with
    // nothing yet deleted and the user can retry. This guarantees a vector
    // outage can never strand the main-DB erasure behind an already-deleted
    // Clerk identity. Embeddings are a derived cache — if a later step fails,
    // the backfill cron simply re-embeds the still-existing foods.
    await storage.coaching.deleteChunksByUserId(userId);
    await deleteFoodEmbeddingsByFoodIds(privateFoodIds);

    // Step 2: Delete the Clerk identity. If this fails the DB row must
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

    // Step 3: Best-effort Strava deauthorization before deleting the DB
    // record (which cascades and removes the stored token). Non-fatal — the
    // user's data will still be deleted. The try/catch also covers a
    // connection read that fails to decrypt (e.g. after a key rotation).
    try {
      const stravaConn = await storage.users.getStravaConnection(userId);
      if (stravaConn) {
        await deauthorizeStravaBestEffort(stravaConn.accessToken, logger);
      }
    } catch (err) {
      logger.warn({ err, userId }, "Strava deauthorization failed during account deletion");
    }

    // Step 4: Garmin upstream revocation — intentionally NOT attempted.
    //
    // Garmin Connect uses an undocumented SSO flow scraped by
    // @flow-js/garmin-connect; the SDK exposes no logout/signOut/revoke
    // method, and Garmin's public API has no documented endpoint to
    // invalidate the OAuth1 / OAuth2 tokens we hold. The only known
    // alternatives are calling Garmin's browser-flow logout URL (which
    // expects session cookies, not API tokens) or POSTing to an
    // undocumented internal endpoint — both are brittle, version-coupled
    // to Garmin's internals, and would create a false sense of upstream
    // invalidation if they silently 401.
    //
    // What we DO guarantee on account deletion:
    //   - The cascade in step 5 removes the garmin_connections row, so
    //     no copy of the encrypted credentials or tokens remains in our
    //     system after this request returns.
    //   - The upstream OAuth1 tokens naturally expire (Garmin's tokens
    //     are short-lived; password-derived session tokens last days).
    //   - Users who need immediate upstream invalidation can change
    //     their Garmin password — surfaced in the privacy page.
    //
    // If Garmin ever publishes a supported revocation API in the SDK,
    // add the call here alongside the Strava deauth in step 3 above.
    const hadGarminConnection = Boolean(await storage.users.getGarminConnection(userId));
    if (hadGarminConnection) {
      logger.info(
        { userId, upstream: "garmin", revoked: false, reason: "no_sdk_revocation_method" },
        "Garmin credentials removed from local storage; upstream tokens will expire naturally",
      );
    }

    // Step 5: Delete the user row and their private custom foods in one
    // transaction — all child rows cascade, including strava_connections and
    // garmin_connections; the foods delete runs after the cascade has removed
    // every referencing row (see deleteUserAndPrivateCustomFoods for the
    // ordering invariants). Public custom foods survive by explicit opt-in.
    const { deleted, deletedFoodIds } = await storage.users.deleteUserAndPrivateCustomFoods(userId);
    if (!deleted) {
      return sendNotFound(res, "User not found");
    }

    // Step 5b: Best-effort second embeddings purge, covering foods created or
    // re-privatized between steps 0 and 5. Idempotent; any miss is mopped up
    // by the dangling-embedding sweep in the backfill cron.
    try {
      await deleteFoodEmbeddingsByFoodIds(deletedFoodIds);
    } catch (err) {
      logger.warn({ err, userId }, "Post-deletion food-embedding purge failed (sweep will catch up)");
    }

    // Step 6: Best-effort purge of the user's rate-limit buckets (S6). Their
    // keys are `${category}:user:${userId}` and are NOT FK-linked to `users`,
    // so the cascade in step 5 leaves them behind until their TTL lapses.
    // Non-fatal — stale buckets only affect that user's now-deleted identity.
    try {
      await storage.users.purgeRateLimitBucketsForUser(userId);
    } catch (err) {
      logger.warn({ err, userId }, "Failed to purge rate-limit buckets during account deletion");
    }

    // Step 7: Best-effort purge of any pending pg-boss jobs for this user, so
    // transient job payloads (userId, plan-generation input) don't linger at
    // rest after erasure. Non-fatal — every handler already no-ops for a
    // deleted user, so a failure here is harmless (W17).
    try {
      await purgeUserJobs(userId);
    } catch (err) {
      // bearer:disable javascript_lang_logger_leak — userId is the app-wide
      // correlation id (logged throughout this handler) and err is a DB error;
      // no secrets, no new PII beyond the handler's existing pattern.
      logger.warn({ err, userId }, "Failed to purge queued jobs during account deletion");
    }

    // Step 8: Evict from the auth seen-cache so stale sessions can't
    // trigger ensureUserExists within the 5-minute TTL window.
    await evictUserFromSeenCache(userId);

    res.json({ success: true });
  });

export default router;
