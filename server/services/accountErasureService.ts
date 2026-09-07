/**
 * Account erasure (GDPR Art. 17) and its self-healing sweep.
 *
 * The erasure has a point of no return: once the Clerk identity is gone the
 * athlete cannot authenticate, so they can never retry a run that dies after
 * that step — their data would sit here indefinitely with nobody able to ask
 * for it again. `users.erasure_requested_at` is stamped before that point, and
 * `runStrandedErasureSweep` finishes any row still carrying the stamp.
 *
 * Extracted from the route handler so the sweep re-runs the SAME steps rather
 * than a re-derived subset. Every step is idempotent: Clerk 404s are treated
 * as success, the vector purges are id-scoped no-ops when the rows are gone,
 * and the DB delete reports `deleted: false` when the row already went.
 */
import { clerkClient } from "@clerk/express";
import type { Logger } from "pino";

import { evictUserFromSeenCache } from "../clerkAuth";
import { env } from "../env";
import { logger as defaultLogger } from "../logger";
import { purgeUserJobs } from "../queue";
import { storage } from "../storage";
import { deauthorizeStravaBestEffort } from "../strava";
import { deleteFoodEmbeddingsByFoodIds } from "./nutrition/foodEmbeddings";

/**
 * How long an erasure may be in flight before the sweep treats it as stranded.
 * Comfortably above a normal run (seconds) so the sweep never races the
 * request that is still working through the steps.
 */
export const STRANDED_ERASURE_THRESHOLD_MS = 15 * 60 * 1000;

/** Most stranded accounts one sweep pass will take on. */
const SWEEP_BATCH_SIZE = 50;

/**
 * Run the full erasure for one user. Returns `deleted: false` only when there
 * was no such user row to delete (a 404 for the route; already-done for the
 * sweep). Throws if any fail-loud step fails, leaving the erasure marker in
 * place for the sweep to retry.
 *
 * Order of operations:
 * 0. Stamp the erasure marker, then capture the user's private custom-food ids
 *    — the capture MUST happen before the step-5 cascade nulls the ownership
 *    column (the only signal linking foods and their embeddings to this user).
 * 1. Purge RAG chunks AND the private foods' embeddings from the separate
 *    vector DB FIRST — fail-loud and before anything irreversible, so a
 *    vector-DB outage makes the whole request retriable rather than orphaning
 *    PII. (Embeddings are a derived cache: if a later step fails, the backfill
 *    cron re-embeds still-existing foods, so deleting early is safe.)
 * 2. Delete the Clerk identity (hard fail, since ensureUserExists would
 *    re-provision the DB row on the next request).
 * 3. Best-effort Strava deauthorization.
 * 4. Garmin upstream revocation is intentionally NOT attempted — see the
 *    comment block at that step for the rationale.
 * 5. Delete the DB user row + private custom foods in ONE transaction
 *    (cascades every child row, including the encrypted Garmin credentials
 *    and OAuth tokens), then a best-effort second embeddings purge for foods
 *    created or re-privatized between steps 0 and 5.
 * 6. Best-effort purge of the user's rate-limit buckets.
 * 7. Best-effort purge of the user's pg-boss jobs (logged at error on failure —
 *    it runs after the marker is gone, so nothing retries it).
 * 8. Evict the user from the auth seen-cache so stale sessions can't
 *    re-provision them.
 */
export async function eraseAccount(
  userId: string,
  log: Logger = defaultLogger,
): Promise<{ deleted: boolean }> {
  // Step 0: mark the erasure as started BEFORE anything irreversible, so a
  // crash past step 2 leaves a row the sweep can find and finish. Keeps an
  // existing stamp, so a retry does not reset "stranded since".
  await storage.users.markErasureRequested(userId);

  // Capture the private custom-food ids while the ownership column still
  // exists (step 5's cascade set-nulls created_by_user_id, and food_embeddings
  // has no user column — this list is the only bridge).
  const privateFoodIds = await storage.nutrition.listPrivateCustomFoodIds(userId);

  // Step 1: purge the user's RAG chunks AND their private foods' embeddings
  // from the SEPARATE vector DB. Both live on `vectorPool` (a separate
  // Postgres instance in production), so the main-DB FK cascade in step 5
  // cannot reach them — without this the user's uploaded coaching-material
  // text and custom-food-name embeddings are orphaned (GDPR Art. 17).
  await storage.coaching.deleteChunksByUserId(userId);
  await deleteFoodEmbeddingsByFoodIds(privateFoodIds);

  // Step 2: delete the Clerk identity. If this fails the DB row must stay
  // intact — otherwise ensureUserExists re-creates it on the next
  // authenticated request, silently "undeleting" the account. A 404 from
  // Clerk means the identity was already removed (e.g. a previous attempt
  // succeeded here and failed later), so treat it as success: that is exactly
  // the case the sweep retries.
  if (env.CLERK_SECRET_KEY) {
    try {
      await clerkClient.users.deleteUser(userId);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status !== 404) throw err;
      // userId is the app-wide correlation id logged throughout this erasure.
      // bearer:disable javascript_lang_logger_leak
      log.info({ userId }, "Clerk user already deleted, continuing with DB cleanup");
    }
  }

  // Step 3: best-effort Strava deauthorization before deleting the DB record
  // (which cascades and removes the stored token). Non-fatal — the user's data
  // will still be deleted. The try/catch also covers a connection read that
  // fails to decrypt (e.g. after a key rotation).
  try {
    const stravaConn = await storage.users.getStravaConnection(userId);
    if (stravaConn) {
      await deauthorizeStravaBestEffort(stravaConn.accessToken, log);
    }
  } catch (err) {
    // err is the Strava/decrypt failure and userId the correlation id; the
    // token itself is never logged.
    // bearer:disable javascript_lang_logger_leak
    log.warn({ err, userId }, "Strava deauthorization failed during account deletion");
  }

  // Step 4: Garmin upstream revocation — intentionally NOT attempted.
  //
  // Garmin Connect uses an undocumented SSO flow scraped by
  // @flow-js/garmin-connect; the SDK exposes no logout/signOut/revoke method,
  // and Garmin's public API has no documented endpoint to invalidate the
  // OAuth1 / OAuth2 tokens we hold. The only known alternatives are calling
  // Garmin's browser-flow logout URL (which expects session cookies, not API
  // tokens) or POSTing to an undocumented internal endpoint — both are
  // brittle, version-coupled to Garmin's internals, and would create a false
  // sense of upstream invalidation if they silently 401.
  //
  // What we DO guarantee on account deletion:
  //   - The cascade in step 5 removes the garmin_connections row, so no copy
  //     of the encrypted credentials or tokens remains in our system after
  //     this returns.
  //   - The upstream OAuth1 tokens naturally expire (Garmin's tokens are
  //     short-lived; password-derived session tokens last days).
  //   - Users who need immediate upstream invalidation can change their
  //     Garmin password — surfaced in the privacy page.
  //
  // If Garmin ever publishes a supported revocation API in the SDK, add the
  // call here alongside the Strava deauth in step 3 above.
  const hadGarminConnection = Boolean(await storage.users.getGarminConnection(userId));
  if (hadGarminConnection) {
    // The correlation id plus three static strings — no credentials.
    // bearer:disable javascript_lang_logger_leak
    log.info(
      { userId, upstream: "garmin", revoked: false, reason: "no_sdk_revocation_method" },
      "Garmin credentials removed from local storage; upstream tokens will expire naturally",
    );
  }

  // Step 5: delete the user row and their private custom foods in one
  // transaction — all child rows cascade, including strava_connections and
  // garmin_connections; the foods delete runs after the cascade has removed
  // every referencing row (see deleteUserAndPrivateCustomFoods for the
  // ordering invariants). Public custom foods survive by explicit opt-in.
  const { deleted, deletedFoodIds } = await storage.users.deleteUserAndPrivateCustomFoods(userId);
  if (!deleted) return { deleted: false };

  // Step 5b: best-effort second embeddings purge, covering foods created or
  // re-privatized between steps 0 and 5. Idempotent; any miss is mopped up by
  // the dangling-embedding sweep in the backfill cron.
  try {
    await deleteFoodEmbeddingsByFoodIds(deletedFoodIds);
  } catch (err) {
    // userId is the handler-wide correlation id and err is a DB error; no secrets.
    // bearer:disable javascript_lang_logger_leak
    log.warn({ err, userId }, "Post-deletion food-embedding purge failed (sweep will catch up)");
  }

  // Step 6: best-effort purge of the user's rate-limit buckets (S6). Their
  // keys are `${category}:user:${userId}` and are NOT FK-linked to `users`, so
  // the cascade in step 5 leaves them behind until their TTL lapses.
  // Non-fatal — stale buckets only affect that user's now-deleted identity.
  try {
    await storage.users.purgeRateLimitBucketsForUser(userId);
  } catch (err) {
    // bearer:disable javascript_lang_logger_leak
    log.warn({ err, userId }, "Failed to purge rate-limit buckets during account deletion");
  }

  // Step 7: best-effort purge of any pending pg-boss jobs for this user, so
  // transient job payloads (userId, plan-generation input) don't linger at rest
  // after erasure. Non-fatal — every handler already no-ops for a deleted user
  // (W17).
  try {
    const purgedJobs = await purgeUserJobs(userId);
    if (purgedJobs > 0) {
      // A count and the correlation id; the job payloads themselves are never logged.
      // bearer:disable javascript_lang_logger_leak
      log.info({ userId, purgedJobs }, "Purged queued jobs during account deletion");
    }
  } catch (err) {
    // Non-fatal for the request — the account row is already gone — but NOT
    // routine: those rows hold the athlete's id and job inputs, and this step
    // runs after the erasure marker was deleted, so nothing retries it. Logged
    // at error so it pages like the stranded-erasure sweep does.
    // userId is the app-wide correlation id and err is a DB error; no secrets.
    // bearer:disable javascript_lang_logger_leak
    log.error(
      { err, userId },
      "Failed to purge queued jobs during account deletion — personal data may remain in the job queue",
    );
  }

  // Step 8: evict from the auth seen-cache so stale sessions can't trigger
  // ensureUserExists within the 5-minute TTL window.
  await evictUserFromSeenCache(userId);

  return { deleted: true };
}

/**
 * Finish every erasure that stopped after its point of no return.
 *
 * A row still carrying `erasure_requested_at` past the threshold is one whose
 * Clerk identity is (almost certainly) already gone: nobody can sign in as
 * that athlete to ask again, so nothing but this sweep will ever complete it.
 * Failures are per-user — one account that keeps failing must not stop the
 * others from being erased — and the row keeps its marker, so the next pass
 * retries it and the returned `failed` count is the signal that something
 * needs a human.
 */
export async function runStrandedErasureSweep(
  now: Date = new Date(),
  log: Logger = defaultLogger,
): Promise<{ swept: number; failed: number }> {
  const cutoff = new Date(now.getTime() - STRANDED_ERASURE_THRESHOLD_MS);
  const stranded = await storage.users.listStrandedErasures(cutoff, SWEEP_BATCH_SIZE);
  let swept = 0;
  let failed = 0;

  for (const account of stranded) {
    try {
      await eraseAccount(account.id, log);
      swept++;
    } catch (err) {
      failed++;
      // userId is the correlation id already logged throughout erasure; the
      // age is a duration. No secrets.
      // bearer:disable javascript_lang_logger_leak
      log.error(
        { err, userId: account.id, strandedSinceMs: now.getTime() - account.erasureRequestedAt.getTime() },
        "Stranded account erasure failed again — account still holds user data",
      );
    }
  }

  return { swept, failed };
}
