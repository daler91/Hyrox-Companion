import { clerkClient } from "@clerk/express";
import { type Request as ExpressRequest, type Response, Router } from "express";

import { evictUserFromSeenCache } from "../clerkAuth";
import { EXTERNAL_API_TIMEOUT_MS } from "../constants";
import { env } from "../env";
import { logger } from "../logger";
import { rateLimiter, sendNotFound } from "../routeUtils";
import { storage } from "../storage";
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
 * `document_chunks` is the exception: it lives on the SEPARATE vector
 * database (`vectorPool`), which the main-DB FK cascade cannot reach, so the
 * user's RAG chunks are purged explicitly in step 1 below (GDPR Art. 17).
 *
 * Order of operations:
 * 1. Purge RAG chunks from the separate vector DB FIRST — fail-loud and
 *    before anything irreversible, so a vector-DB outage makes the whole
 *    request retriable rather than orphaning PII or stranding erasure.
 * 2. Delete Clerk identity (hard fail if this fails, since ensureUserExists
 *    would re-provision the DB row on next request).
 * 3. Best-effort Strava deauthorization.
 * 4. Note: Garmin upstream revocation is intentionally NOT attempted —
 *    see the comment block at the deletion step for the rationale.
 * 5. Delete DB user row (cascades all child rows, including the encrypted
 *    Garmin credentials and OAuth tokens in garmin_connections).
 * 6. Evict user from auth seen-cache to prevent stale session use.
 */
protectedDelete(router, "/api/v1/account", { limiter: rateLimiter("accountDelete", 3) }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);

    // Step 1: Purge the user's RAG chunks from the SEPARATE vector DB FIRST,
    // before any irreversible action. `document_chunks` lives on `vectorPool`
    // (a separate Postgres instance in production), so the main-DB FK cascade
    // in step 5 cannot reach it — without this the user's uploaded
    // coaching-material text and embeddings are orphaned (GDPR Art. 17).
    // Ordering it first is deliberate: it is fail-loud, so if the vector DB is
    // unreachable the request fails with nothing yet deleted and the user can
    // retry. This guarantees a vector outage can never strand the main-DB
    // erasure behind an already-deleted Clerk identity.
    await storage.coaching.deleteChunksByUserId(userId);

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
    // record (which cascades and removes the stored token).
    try {
      const stravaConn = await storage.users.getStravaConnection(userId);
      if (stravaConn) {
        await fetch("https://www.strava.com/oauth/deauthorize", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ access_token: stravaConn.accessToken }).toString(),
          signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
        });
      }
    } catch (err) {
      // Non-fatal — the user's data will still be deleted.
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

    // Step 5: Delete the user row — all child rows cascade, including
    // strava_connections and garmin_connections.
    const deleted = await storage.users.deleteUser(userId);
    if (!deleted) {
      return sendNotFound(res, "User not found");
    }

    // Step 6: Evict from the auth seen-cache so stale sessions can't
    // trigger ensureUserExists within the 5-minute TTL window.
    await evictUserFromSeenCache(userId);

    res.json({ success: true });
  });

export default router;
