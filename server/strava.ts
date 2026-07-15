import crypto from "node:crypto";

import { type StravaConnection } from "@shared/schema";
import { type DistanceUnit } from "@shared/unitConversion";
import type { Request, Response, Router } from "express";
import rateLimit from "express-rate-limit";

import { withPgAdvisoryLock } from "./advisoryLock";
import { isAuthenticated } from "./clerkAuth";
import { EXTERNAL_API_TIMEOUT_MS,MS_PER_DAY, RATE_LIMIT_WINDOW_15M_MS, STRAVA_STATE_MAX_AGE_MS } from "./constants";
import { pool } from "./db";
import { env } from "./env";
import { AppError, ErrorCode } from "./errors";
import { logger, reqLogger } from "./logger";
import { protectedMutationGuards } from "./routeGuards";
import { asyncHandler } from "./routeUtils";
import { mapStravaActivityToWorkout, type StravaActivity } from "./services/stravaMapper";
import { claimRuntimeCacheKey, runtimeCacheKey } from "./sharedRuntimeState";
import { storage } from "./storage";
import { getUserId } from "./types";
import { parseRetryAfter,RetryableHttpError, retryWithJitter } from "./utils/httpRetry";

const STRAVA_CLIENT_ID = env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI = env.APP_URL
  ? `${env.APP_URL}/api/v1/strava/callback`
  : "http://localhost:5000/api/v1/strava/callback";

const STRAVA_OAUTH_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_OAUTH_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_OAUTH_DEAUTHORIZE_URL = "https://www.strava.com/oauth/deauthorize";
const STRAVA_API_BASE = "https://www.strava.com/api/v3";
// Requested at /auth AND persisted on the connection at /callback — keep the
// two in lockstep via this single constant so they cannot drift.
const STRAVA_SCOPE = "activity:read_all";

const STATE_SECRET = env.STRAVA_STATE_SECRET ?? crypto.randomBytes(32).toString("hex");
if (!env.STRAVA_STATE_SECRET) {
  logger.warn({ context: "strava" }, "STRAVA_STATE_SECRET not configured — using random secret. Strava OAuth state will not be verifiable across multiple server instances.");
}

const stravaAuthLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_15M_MS,
  max: 20,
  message: "Too many requests from this IP, please try again after 15 minutes",
});

const stravaSyncLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_15M_MS,
  max: 5,
  message: "Too many sync requests, please try again after 15 minutes",
});
const STATE_MAX_AGE_MS = STRAVA_STATE_MAX_AGE_MS;


export function createSignedState(userId: string): string {
  const timestamp = Date.now().toString(36);
  const nonce = crypto.randomBytes(8).toString("hex");
  const payload = `${userId}:${timestamp}:${nonce}`;
  // 🛡️ Sentinel: Use full 256-bit HMAC — no truncation needed
  const signature = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("hex");
  return `${payload}:${signature}`;
}

export function verifySignedState(state: string): { userId: string } | null {
  const parts = state.split(":");
  if (parts.length !== 4) return null;
  const [userId, timestamp, nonce, signature] = parts;
  const payload = `${userId}:${timestamp}:${nonce}`;
  const expected = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("hex");

  // Use timingSafeEqual with hashed values to prevent timing attacks
  // and safely handle different string lengths.
  const signatureHash = crypto.createHash("sha256").update(signature).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();

  if (!crypto.timingSafeEqual(signatureHash, expectedHash)) return null;
  const ts = Number.parseInt(timestamp, 36);
  if (Date.now() - ts > STATE_MAX_AGE_MS) return null;
  return { userId };
}

interface StravaTokenResponse {
  token_type: string;
  expires_at: number;
  expires_in: number;
  refresh_token: string;
  access_token: string;
  // Present on the authorization-code exchange, absent on refresh_token
  // grants — Strava only echoes the athlete when a user just authorized.
  athlete?: {
    id: number;
    username: string;
    firstname: string;
    lastname: string;
  };
}

type StravaRefreshResult =
  | { ok: true; data: StravaTokenResponse }
  // permanent: Strava rejected the refresh token itself (400 invalid_grant /
  // 401 / 403 — the user revoked the app). Retrying can never succeed; the
  // user must re-authorize. Non-permanent failures (network, 429/5xx after
  // retry exhaustion) are transient and worth retrying later.
  | { ok: false; permanent: boolean };

async function refreshStravaToken(refreshToken: string): Promise<StravaRefreshResult> {
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    logger.error("Strava credentials not configured");
    return { ok: false, permanent: false };
  }

  try {
    return await retryWithJitter<StravaRefreshResult>(
      async () => {
        const response = await fetch(STRAVA_OAUTH_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: STRAVA_CLIENT_ID,
            client_secret: STRAVA_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          }),
          signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
        });

        if (response.status === 429 || response.status >= 500) {
          throw new RetryableHttpError(
            response.status,
            parseRetryAfter(response.headers.get("retry-after")),
          );
        }
        if (!response.ok) {
          // Do NOT log the raw response body — Strava OAuth token-endpoint
          // bodies can echo token/secret material and a hand-built `err` string
          // bypasses pino's path-based redaction. Status is enough to triage.
          // bearer:disable javascript_lang_logger_leak — only the HTTP status
          // code is logged; the raw body was deliberately dropped above (W1).
          logger.error({ status: response.status }, "Failed to refresh Strava token");
          // Remaining 4xx here means Strava rejected the grant itself.
          return { ok: false, permanent: true };
        }
        return { ok: true, data: (await response.json()) as StravaTokenResponse };
      },
      { label: "strava.refreshToken", retries: 3 },
    );
  } catch (error) {
    logger.error({ err: error }, "Error refreshing Strava token:");
    return { ok: false, permanent: false };
  }
}

// Refresh 60s before the token would actually expire so an in-flight request
// never uses a token that flips to expired between our check and Strava's.
const STRAVA_REFRESH_SAFETY_WINDOW_MS = 60_000;

// When the refresh advisory lock is held by a concurrent request, poll the
// connection briefly for its result instead of failing: a refresh round-trip
// completes well within 3 × 500ms.
const STRAVA_REFRESH_LOCK_POLL_MS = 500;
const STRAVA_REFRESH_LOCK_POLL_ATTEMPTS = 3;

function hasFreshToken(connection: StravaConnection): boolean {
  return connection.expiresAt.getTime() > Date.now() + STRAVA_REFRESH_SAFETY_WINDOW_MS;
}

// Per-user 64-bit advisory-lock key in a Strava-refresh namespace, derived
// from the userId so concurrent refreshes for different users never contend.
function stravaRefreshLockKey(userId: string): bigint {
  const digest = crypto.createHash("sha256").update(`strava-refresh:${userId}`).digest();
  return BigInt.asIntN(64, digest.readBigUInt64BE(0));
}

type StravaAccessResult =
  | { ok: true; accessToken: string; connection: StravaConnection }
  | { ok: false; reason: "not_connected" | "reauth_required" | "transient" };

/**
 * Returns a currently-valid access token, refreshing it if needed.
 *
 * Strava ROTATES the refresh token on every refresh and invalidates the old
 * one, so two concurrent refreshes with the same stored token brick the
 * connection. The refresh is therefore serialized under a per-user Postgres
 * advisory lock (cross-instance safe) with a re-read inside the lock so the
 * loser of the race reuses the winner's freshly-stored token instead of
 * refreshing again.
 *
 * Exported for tests only.
 */
export async function getValidAccessToken(userId: string): Promise<StravaAccessResult> {
  const connection = await storage.users.getStravaConnection(userId);
  if (!connection) return { ok: false, reason: "not_connected" };
  if (connection.requiresReauth) return { ok: false, reason: "reauth_required" };
  if (hasFreshToken(connection)) {
    return { ok: true, accessToken: connection.accessToken, connection };
  }

  const lockResult = await withPgAdvisoryLock<StravaAccessResult>(
    pool,
    { key: stravaRefreshLockKey(userId), name: "strava-refresh" },
    async () => {
      // Double-check under the lock: a concurrent request may have refreshed
      // between our staleness check and acquiring the lock.
      const current = await storage.users.getStravaConnection(userId);
      if (!current) return { ok: false, reason: "not_connected" };
      if (current.requiresReauth) return { ok: false, reason: "reauth_required" };
      if (hasFreshToken(current)) {
        return { ok: true, accessToken: current.accessToken, connection: current };
      }

      const refreshed = await refreshStravaToken(current.refreshToken);
      if (!refreshed.ok) {
        if (refreshed.permanent) {
          // Tombstone the connection so /status flips to "reconnect needed"
          // instead of every future sync dying with a generic 401.
          await storage.users.setStravaReauthRequired(userId);
          return { ok: false, reason: "reauth_required" };
        }
        return { ok: false, reason: "transient" };
      }

      await storage.users.updateStravaTokens(userId, {
        accessToken: refreshed.data.access_token,
        refreshToken: refreshed.data.refresh_token,
        expiresAt: new Date(refreshed.data.expires_at * 1000),
      });

      return {
        ok: true,
        accessToken: refreshed.data.access_token,
        connection: { ...current, accessToken: refreshed.data.access_token },
      };
    },
  );

  if (lockResult.acquired) {
    return lockResult.value;
  }

  // withPgAdvisoryLock is a non-blocking try-lock: not acquired means another
  // request/instance is refreshing this user's token right now. Poll for its
  // result rather than failing outright.
  for (let attempt = 0; attempt < STRAVA_REFRESH_LOCK_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, STRAVA_REFRESH_LOCK_POLL_MS));
    const current = await storage.users.getStravaConnection(userId);
    if (!current) return { ok: false, reason: "not_connected" };
    if (current.requiresReauth) return { ok: false, reason: "reauth_required" };
    if (hasFreshToken(current)) {
      return { ok: true, accessToken: current.accessToken, connection: current };
    }
  }
  return { ok: false, reason: "transient" };
}

async function handleStravaStatus(req: Request, res: Response) {
  // Errors propagate to asyncHandler → central error middleware.
  const userId = getUserId(req);
  const connection = await storage.users.getStravaConnection(userId);

  if (!connection) {
    return res.json({ connected: false });
  }

  res.json({
    connected: true,
    athleteId: connection.stravaAthleteId,
    lastSyncedAt: connection.lastSyncedAt,
    requiresReauth: connection.requiresReauth,
  });
}

async function handleStravaAuth(req: Request, res: Response) {
  if (!STRAVA_CLIENT_ID) {
    return res.status(500).json({ error: "Strava integration not configured", code: "INTERNAL_SERVER_ERROR" });
  }

  const userId = getUserId(req);

  const state = createSignedState(userId);

  const authUrl = new URL(STRAVA_OAUTH_AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", STRAVA_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", STRAVA_REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", STRAVA_SCOPE);
  authUrl.searchParams.set("state", state);

  res.json({ authUrl: authUrl.toString() });
}

async function handleStravaCallback(req: Request, res: Response) {
  const { code, state, error: stravaError } = req.query;

  if (stravaError) {
    reqLogger(req).error("Strava auth error received from provider");
    return res.redirect("/settings?strava=error");
  }

  if (typeof state !== "string" || typeof code !== "string") {
    reqLogger(req).error("Strava OAuth callback received invalid query params");
    return res.redirect("/settings?strava=error");
  }

  const verified = verifySignedState(state);
  if (!verified) {
    reqLogger(req).error("Strava OAuth state invalid or expired - possible CSRF attack");
    return res.redirect("/settings?strava=error");
  }

  // Single-use state: the HMAC makes the state unforgeable but not
  // unreplayable — atomically claim it (cross-instance, via the shared
  // runtime cache) so a captured callback URL is dead after first use.
  // TTL matches the state's own max age; after that verifySignedState
  // rejects it anyway.
  const stateClaimed = await claimRuntimeCacheKey(
    runtimeCacheKey("strava-oauth-state", state),
    STATE_MAX_AGE_MS,
  );
  if (!stateClaimed) {
    reqLogger(req).error("Strava OAuth state replayed - possible CSRF attack");
    return res.redirect("/settings?strava=error");
  }

  const userId = verified.userId;

  if (!userId || !STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    return res.redirect("/settings?strava=error");
  }

  try {
    const tokenResponse = await retryWithJitter(async () => {
      const r = await fetch(STRAVA_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: STRAVA_CLIENT_ID,
          client_secret: STRAVA_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
      });

      if (r.status === 429 || r.status >= 500) {
        throw new RetryableHttpError(r.status, parseRetryAfter(r.headers.get("retry-after")));
      }
      return r;
    }, { label: "strava.oauthToken", retries: 3 });

    if (!tokenResponse.ok) {
      // Do NOT log the raw response body (see refreshToken above) — it can
      // contain token/secret material and bypasses pino redaction. Status only.
      reqLogger(req).error({ status: tokenResponse.status }, "Token exchange failed");
      return res.redirect("/settings?strava=error");
    }

    const tokenData = (await tokenResponse.json()) as StravaTokenResponse;

    if (!tokenData.athlete) {
      reqLogger(req).error("Strava token exchange response missing athlete data");
      return res.redirect("/settings?strava=error");
    }

    await storage.users.upsertStravaConnection({
      userId,
      stravaAthleteId: String(tokenData.athlete.id),
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(tokenData.expires_at * 1000),
      scope: STRAVA_SCOPE,
      lastSyncedAt: null,
    });

    res.redirect("/settings?strava=connected");
  } catch (error) {
    reqLogger(req).error({ err: error }, "Strava callback error:");
    res.redirect("/settings?strava=error");
  }
}

/**
 * Best-effort upstream revocation. Deleting our local row alone leaves the
 * app authorized on strava.com until the user manually removes it there, so
 * disconnect and account deletion both ask Strava to revoke the grant.
 * Failures are swallowed: local deletion must never be blocked by a Strava
 * outage or an already-expired access token.
 */
export async function deauthorizeStravaBestEffort(
  accessToken: string,
  log: Pick<typeof logger, "warn">,
): Promise<void> {
  try {
    await fetch(STRAVA_OAUTH_DEAUTHORIZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: accessToken }).toString(),
      signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
    });
  } catch (err) {
    // bearer:disable javascript_lang_logger_leak — `err` is a network/timeout
    // error from fetch; the access token travels in the request body, which
    // fetch never echoes into its error objects. No secret material is logged.
    log.warn({ err }, "Strava deauthorization failed (non-fatal)");
  }
}

async function handleStravaDisconnect(req: Request, res: Response) {
  // Errors propagate to asyncHandler → central error middleware.
  const userId = getUserId(req);
  const connection = await storage.users.getStravaConnection(userId);
  if (connection) {
    // Revoke upstream first — after deleteStravaConnection the token is gone.
    // No refresh attempt: if the access token already expired the revoke is
    // best-effort anyway, and a refresh here would burn a rotation for nothing.
    await deauthorizeStravaBestEffort(connection.accessToken, reqLogger(req));
  }
  await storage.users.deleteStravaConnection(userId);
  res.json({ success: true });
}

// Strava's documented per_page maximum — fewest read requests per sync.
const STRAVA_ACTIVITIES_PER_PAGE = 200;
// Cap a single sync at 5 pages (≤1000 activities, ≤5 read requests) to stay
// well inside Strava's 100-reads/15-min app budget. A capped sync reports
// hasMore and advances the cursor only through what it fetched, so the next
// sync resumes seamlessly.
const STRAVA_MAX_SYNC_PAGES = 5;
// First sync (no cursor yet) backfills this window — matches the app's
// analytics horizon and keeps the initial import to ~1 page for most users.
const STRAVA_FIRST_SYNC_BACKFILL_DAYS = 90;
// Strava indexes `after` by activity start_date, but devices can upload days
// late (watch synced after a week offline). Re-scanning a 7-day overlap makes
// those unlosable; the DB dedup absorbs the handful of re-fetched rows.
const STRAVA_SYNC_OVERLAP_MS = 7 * MS_PER_DAY;

/**
 * Computes the `after` query param (epoch SECONDS, per the Strava API
 * contract) for an incremental sync.
 */
export function computeSyncAfterEpoch(lastSyncedAt: Date | null, now: Date = new Date()): number {
  const afterMs = lastSyncedAt
    ? lastSyncedAt.getTime() - STRAVA_SYNC_OVERLAP_MS
    : now.getTime() - STRAVA_FIRST_SYNC_BACKFILL_DAYS * MS_PER_DAY;
  return Math.max(0, Math.floor(afterMs / 1000));
}

// Split out of handleStravaSync so the main handler stays under
// SonarCloud's cognitive-complexity ceiling. Classifies upstream
// responses so retryWithJitter can distinguish retryable (429, 5xx)
// from non-retryable auth-revocation failures.
//
// NOTE: with `after` set, Strava returns activities in ASCENDING start_date
// order — callers rely on "last element = newest fetched" for the cursor.
//
// Exported for tests only.
export async function fetchStravaActivities(
  accessToken: string,
  log: Pick<typeof logger, "error">,
  afterEpochSeconds: number,
): Promise<{ activities: StravaActivity[]; hasMore: boolean }> {
  const activities: StravaActivity[] = [];

  for (let page = 1; page <= STRAVA_MAX_SYNC_PAGES; page++) {
    const url = new URL(`${STRAVA_API_BASE}/athlete/activities`);
    url.searchParams.set("after", String(afterEpochSeconds));
    url.searchParams.set("per_page", String(STRAVA_ACTIVITIES_PER_PAGE));
    url.searchParams.set("page", String(page));

    const pageActivities = await retryWithJitter(
      async () => {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
        });

        if (response.status === 429 || response.status >= 500) {
          throw new RetryableHttpError(
            response.status,
            parseRetryAfter(response.headers.get("retry-after")),
          );
        }
        if (response.status === 401 || response.status === 403) {
          // Token was revoked on Strava's side (user removed our app) — a
          // refresh won't help, we need the user to reconnect. Non-retryable.
          throw new AppError(
            ErrorCode.UNAUTHORIZED,
            "Strava authorization was revoked — please reconnect your account",
            401,
          );
        }
        if (!response.ok) {
          // Do NOT log the raw response body (same rationale as the token
          // endpoint above) — hand-built `err` strings bypass pino's
          // path-based redaction. Status is enough to triage.
          // bearer:disable javascript_lang_logger_leak — only the HTTP status
          // code is logged; the raw body was deliberately dropped above.
          log.error(
            { status: response.status },
            "Failed to fetch Strava activities",
          );
          throw new AppError(
            ErrorCode.EXTERNAL_API_ERROR,
            `Strava activities request failed: ${response.status}`,
            502,
          );
        }
        return (await response.json()) as StravaActivity[];
      },
      { label: "strava.listActivities", retries: 3 },
    );

    activities.push(...pageActivities);

    // A short page means we've drained everything in the window.
    if (pageActivities.length < STRAVA_ACTIVITIES_PER_PAGE) {
      return { activities, hasMore: false };
    }
  }

  // Every allowed page came back full — assume more remain past the cap.
  return { activities, hasMore: true };
}

// The list endpoint NEVER returns `calories` (only the per-activity detail
// endpoint does) and the kilojoules fallback only exists for power-meter
// rides — so without enrichment nearly every imported activity shows an
// empty calories chip. Cap detail fetches per sync to protect Strava's
// 100-reads/15-min app budget: steady-state syncs import a handful of
// activities and get fully enriched; a large backfill enriches only the
// newest 25 (the ones users actually look at).
const STRAVA_CALORIE_DETAIL_LIMIT = 25;

interface StravaDetailedActivity {
  id: number;
  calories?: number;
}

/**
 * Best-effort, budget-capped calorie enrichment for newly-imported workouts
 * (mutated in place). Never throws — a failed detail fetch just leaves the
 * list-derived row as-is.
 */
async function enrichCaloriesFromDetail(
  accessToken: string,
  workouts: ReturnType<typeof mapStravaActivityToWorkout>[],
  log: Pick<typeof logger, "warn">,
): Promise<void> {
  // Activities arrive in ascending start_date order — slice from the end to
  // enrich the newest ones.
  const candidates = workouts
    .filter((w) => w.calories === null)
    .slice(-STRAVA_CALORIE_DETAIL_LIMIT);

  let failures = 0;
  for (const workout of candidates) {
    try {
      const detail = await retryWithJitter(
        async () => {
          const response = await fetch(
            `${STRAVA_API_BASE}/activities/${workout.stravaActivityId}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
            },
          );
          if (response.status === 429 || response.status >= 500) {
            throw new RetryableHttpError(
              response.status,
              parseRetryAfter(response.headers.get("retry-after")),
            );
          }
          // Any other failure: keep the list-derived row, no calories.
          if (!response.ok) return null;
          return (await response.json()) as StravaDetailedActivity;
        },
        // Enrichment is optional garnish — retry once, not the full 3 times.
        { label: "strava.activityDetail", retries: 1 },
      );
      if (detail?.calories) {
        workout.calories = Math.round(detail.calories);
      }
    } catch (err) {
      if (err instanceof RetryableHttpError && err.status === 429) {
        // Rate-limited: stop hammering — the remaining rows simply keep
        // calories null. The sync itself still succeeds.
        // bearer:disable javascript_lang_logger_leak — only a count is
        // logged; no activity data or token material.
        log.warn(
          { attempted: candidates.length },
          "Strava calorie enrichment stopped early: rate-limited (non-fatal)",
        );
        return;
      }
      failures++;
    }
  }
  if (failures > 0) {
    // bearer:disable javascript_lang_logger_leak — only counts are logged;
    // no activity data or token material.
    log.warn(
      { failures, attempted: candidates.length },
      "Strava calorie enrichment partially failed (non-fatal)",
    );
  }
}

// Translate upstream errors into actionable client responses instead
// of a blanket 500 (Warning-13):
//  - 429 after retry exhaustion → surface Retry-After so the UI can
//    schedule a reconnect instead of nagging the user to retry.
//  - 401/403 → explicit "reconnect Strava" path.
function sendStravaFetchError(res: Response, err: unknown): Response {
  if (err instanceof RetryableHttpError && err.status === 429) {
    const retrySeconds = err.retryAfterMs ? Math.ceil(err.retryAfterMs / 1000) : 60;
    res.setHeader("Retry-After", String(retrySeconds));
    return res.status(429).json({
      error: `Strava rate-limited the request. Please retry in about ${Math.ceil(retrySeconds / 60)} minute(s).`,
      code: "RATE_LIMITED",
      retryAfterSeconds: retrySeconds,
    });
  }
  if (err instanceof AppError && err.status === 401) {
    return res.status(401).json({
      error: err.message,
      code: "STRAVA_REAUTH_REQUIRED",
    });
  }
  return res.status(502).json({
    error: "Strava is temporarily unavailable. Please try again shortly.",
    code: "EXTERNAL_API_ERROR",
  });
}

async function handleStravaSync(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    const tokenResult = await getValidAccessToken(userId);

    if (!tokenResult.ok) {
      if (tokenResult.reason === "reauth_required") {
        return res.status(401).json({
          error: "Strava authorization was revoked — please reconnect your account",
          code: "STRAVA_REAUTH_REQUIRED",
        });
      }
      if (tokenResult.reason === "not_connected") {
        return res.status(401).json({ error: "Strava not connected", code: "UNAUTHORIZED" });
      }
      // transient: refresh failed on a retryable error or a concurrent
      // refresh didn't land in time — the client can simply retry.
      return res.status(502).json({
        error: "Strava is temporarily unavailable. Please try again shortly.",
        code: "EXTERNAL_API_ERROR",
      });
    }
    const { accessToken, connection } = tokenResult;

    const user = await storage.users.getUser(userId);
    const distanceUnit = (user?.distanceUnit || "km") as DistanceUnit;

    let activities: StravaActivity[];
    let hasMore: boolean;
    try {
      ({ activities, hasMore } = await fetchStravaActivities(
        accessToken,
        reqLogger(req),
        computeSyncAfterEpoch(connection.lastSyncedAt),
      ));
    } catch (err) {
      reqLogger(req).error({ err }, "Failed to fetch Strava activities after retries:");
      if (err instanceof AppError && err.status === 401) {
        // Authorization revoked upstream mid-flight — tombstone the
        // connection so /status flips to "reconnect needed" too.
        await storage.users.setStravaReauthRequired(userId);
      }
      return sendStravaFetchError(res, err);
    }

    const activityIds = activities.map(a => String(a.id));
    const existingIds = await storage.workouts.getExistingStravaActivityIds(userId, activityIds);
    const existingStravaIds = new Set(existingIds);

    let skipped = 0;
    const workoutsToImport = [];

    for (const activity of activities) {
      if (existingStravaIds.has(String(activity.id))) {
        skipped++;
        continue;
      }

      workoutsToImport.push(mapStravaActivityToWorkout(activity, userId, distanceUnit));
    }

    if (workoutsToImport.length > 0) {
      await enrichCaloriesFromDetail(accessToken, workoutsToImport, reqLogger(req));
    }

    const createdLogs = workoutsToImport.length > 0
      ? await storage.workouts.createWorkoutLogs(workoutsToImport)
      : [];
    // onConflictDoNothing returns only the rows this insert actually
    // created; concurrent Strava syncs can drop rows here and we want the
    // response to reflect the truth, not the optimistic pre-insert count
    // (S2). `skipped` sums the pre-dedup hits plus any race-condition
    // duplicates the DB rejected.
    const imported = createdLogs.length;
    const raceSkipped = workoutsToImport.length - createdLogs.length;

    if (hasMore && activities.length > 0) {
      // Capped sync: advance the cursor only through the fetched window
      // (ascending order ⇒ last element is the newest we saw) so the next
      // sync resumes exactly where this one stopped instead of skipping the
      // unfetched activities.
      await storage.users.updateStravaLastSync(
        userId,
        new Date(activities[activities.length - 1].start_date),
      );
    } else {
      await storage.users.updateStravaLastSync(userId);
    }

    reqLogger(req).info(
      { context: "strava", userId, imported, skipped: skipped + raceSkipped, total: activities.length, hasMore },
      "strava.sync.ok",
    );

    res.json({
      success: true,
      imported,
      skipped: skipped + raceSkipped,
      total: activities.length,
      hasMore,
    });
  } catch (error) {
    reqLogger(req).error({ err: error }, "Strava sync error:");
    res.status(500).json({ error: "Failed to sync Strava activities", code: "INTERNAL_SERVER_ERROR" });
  }
}

export function registerStravaRoutes(router: Router): void {
  router.get("/api/v1/strava/status", isAuthenticated, asyncHandler(handleStravaStatus));
  router.get("/api/v1/strava/auth", isAuthenticated, stravaAuthLimiter, asyncHandler(handleStravaAuth));
  router.get("/api/v1/strava/callback", stravaAuthLimiter, asyncHandler(handleStravaCallback));
  router.delete("/api/v1/strava/disconnect", ...protectedMutationGuards, asyncHandler(handleStravaDisconnect));
  router.post("/api/v1/strava/sync", ...protectedMutationGuards, stravaSyncLimiter, asyncHandler(handleStravaSync));
}
