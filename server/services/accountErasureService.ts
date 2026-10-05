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
import { inSequence } from "@shared/inSequence";
import type { Logger } from "pino";

import { evictUserFromSeenCache, rememberUserErased } from "../clerkAuth";
import { env } from "../env";
import { logger as defaultLogger } from "../logger";
import { purgeUserJobs } from "../queue";
import { storage } from "../storage";
import { deauthorizeStravaBestEffort } from "../strava";
import { deleteFoodEmbeddingsByFoodIds } from "./nutrition/foodEmbeddings";
import { purgeRagCacheForUser } from "./ragService";

/**
 * How long an erasure may be in flight before the sweep treats it as stranded.
 * Comfortably above a normal run (seconds) so the sweep never races the
 * request that is still working through the steps.
 */
export const STRANDED_ERASURE_THRESHOLD_MS = 15 * 60 * 1000;

/** Most stranded accounts one sweep pass will take on. */
const SWEEP_BATCH_SIZE = 50;

/**
 * A run that fails before the Clerk identity is deleted leaves an athlete who
 * can still sign in and who is told "Deletion failed". Withdraw the stamp this
 * run wrote, or the sweep would finish that deletion 15-75 minutes later
 * anyway, and the background jobs would skip the athlete until it did. A stamp
 * an earlier run wrote is left alone: that run may have got past the Clerk
 * step. P17 (CODEBASE_ANALYSIS_2026-10-03)
 */
async function withdrawErasureStamp(userId: string, stampedAt: Date | null, log: Logger): Promise<void> {
  if (!stampedAt) return;
  try {
    await storage.users.clearErasureRequest(userId, stampedAt);
  } catch (err) {
    // userId is the correlation id logged throughout this erasure and err a
    // DB error; no secrets.
    // bearer:disable javascript_lang_logger_leak
    log.error({ err, userId }, "Could not withdraw the erasure stamp of a failed deletion; the sweep will finish it");
  }
}

/**
 * Whether a Clerk error is Clerk declining the delete (a 4xx), which leaves
 * the identity in place, rather than an outcome we cannot know (a 5xx, a
 * timeout, a dropped connection), after which the identity may be gone.
 */
function clerkDeclined(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500;
}

/**
 * Run the full erasure for one user. Returns `deleted: false` only when there
 * was no such user row to delete (a 404 for the route; already-done for the
 * sweep). Throws if any fail-loud step fails. A failure past the Clerk step
 * leaves the erasure marker in place for the sweep to retry; one before it
 * withdraws the marker this run wrote (withdrawErasureStamp).
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
 * 1b. Purge the user's cached RAG retrievals (fail-loud).
 * 2. Delete the Clerk identity (hard fail, since ensureUserExists would
 *    re-provision the DB row on the next request).
 * 2b. Tombstone the id in the auth layer (fail-loud) so a Clerk session token
 *    minted before step 2, still valid for up to its lifetime, is refused
 *    instead of re-provisioning the row step 5 deletes.
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
 * 8. Evict the user from the auth seen-cache, so a stale session misses it
 *    and meets the step-2b tombstone (401) instead of passing as "seen".
 */
export async function eraseAccount(
  userId: string,
  log: Logger = defaultLogger,
): Promise<{ deleted: boolean }> {
  // Step 0: mark the erasure as started BEFORE anything irreversible, so a
  // crash past step 2 leaves a row the sweep can find and finish. Keeps an
  // existing stamp, so a retry does not reset "stranded since".
  const stampedAt = await storage.users.markErasureRequested(userId);

  try {
    // Capture the private custom-food ids while the ownership column still
    // exists (step 5's cascade set-nulls created_by_user_id, and
    // food_embeddings has no user column — this list is the only bridge).
    const privateFoodIds = await storage.nutrition.listPrivateCustomFoodIds(userId);

    // Step 1: purge the user's RAG chunks AND their private foods' embeddings
    // from the SEPARATE vector DB. Both live on `vectorPool` (a separate
    // Postgres instance in production), so the main-DB FK cascade in step 5
    // cannot reach them — without this the user's uploaded coaching-material
    // text and custom-food-name embeddings are orphaned (GDPR Art. 17).
    await storage.coaching.deleteChunksByUserId(userId);
    await deleteFoodEmbeddingsByFoodIds(privateFoodIds);
    // Step 1b: the RAG retrieval cache holds plaintext excerpts of those
    // chunks in `server_runtime_cache` on the main DB, keyed by user but not
    // FK-linked, so neither purge above nor the step-5 cascade reaches it.
    // Fail-loud like step 1; after the chunk purge, so a retrieval racing it
    // can only re-cache an empty result. P13 (CODEBASE_ANALYSIS_2026-10-03)
    await purgeRagCacheForUser(userId);
  } catch (err) {
    // Nothing irreversible has happened yet (P17).
    await withdrawErasureStamp(userId, stampedAt, log);
    throw err;
  }

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
      if (status !== 404) {
        // Clerk declining leaves the identity, so this run stopped short of
        // its point of no return; any other failure may not have (P17).
        if (clerkDeclined(status)) await withdrawErasureStamp(userId, stampedAt, log);
        throw err;
      }
      // userId is the app-wide correlation id logged throughout this erasure.
      // bearer:disable javascript_lang_logger_leak
      log.info({ userId }, "Clerk user already deleted, continuing with DB cleanup");
    }
  }

  // Step 2b: from here on any session for this id is stale, but Clerk verifies
  // its JWT locally until it expires. Once step 5 deletes the row,
  // ensureUserExists would read such a request as a first sign-in and recreate
  // the account, with no erasure marker for the sweep to find. The tombstone
  // makes it answer 401 instead, and must be written before the row goes.
  // P5 (CODEBASE_ANALYSIS_2026-10-03)
  await rememberUserErased(userId);

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
  // keys are `${category}:${maxRequests}:${windowMs}:user:${userId}` (C5,
  // CODEBASE_ANALYSIS_2026-10-03) and are NOT FK-linked to `users`, so
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

  // Step 8: evict from the auth seen-cache. A stale session then reaches
  // ensureUserExists, finds no row and meets the step-2b tombstone (401),
  // instead of passing as "seen" for the rest of the 5-minute TTL. The eviction
  // alone used to be what let it re-provision the account.
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

  // One account at a time: each erasure calls Clerk and Strava and deletes
  // across both databases, which a background sweep should not fan out.
  const erased = await inSequence(stranded, async (account) => {
    try {
      await eraseAccount(account.id, log);
      return true;
    } catch (err) {
      // userId is the correlation id already logged throughout erasure; the
      // age is a duration. No secrets.
      // bearer:disable javascript_lang_logger_leak
      log.error(
        { err, userId: account.id, strandedSinceMs: now.getTime() - account.erasureRequestedAt.getTime() },
        "Stranded account erasure failed again — account still holds user data",
      );
      return false;
    }
  });

  const swept = erased.filter(Boolean).length;
  return { swept, failed: erased.length - swept };
}
