import { GarminConnect, type IOauth1Token, type IOauth2Token } from "@flow-js/garmin-connect";
import { type DistanceUnit } from "@shared/unitConversion";
import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { isAuthenticated } from "./clerkAuth";
import { RATE_LIMIT_WINDOW_15M_MS } from "./constants";
import { logger } from "./logger";
import { protectedMutationGuards } from "./routeGuards";
import { asyncHandler } from "./routeUtils";
import { type GarminActivity,mapGarminActivityToWorkout } from "./services/garminMapper";
import { storage } from "./storage";
import { getUserId } from "./types";

// =============================================================================
// SAFETY LAYERS — read this before tweaking anything in this file
// =============================================================================
//
// Garmin actively bans IPs that hammer their SSO. Because every user on this
// server hits Garmin from the SAME outbound IP, a single misbehaving user (or
// a buggy code path) could earn an IP ban for everyone. The layers below are
// strict on purpose — prefer "annoy the user" over "earn an IP ban".
//
// Layer 1 — Express rate limiter
//   Per-user, per-route ceilings on /connect and /sync. First line of defence
//   against accidental click spam.
//
// Layer 2 — Per-user in-flight mutex (inFlightUsers)
//   Refuses overlapping /connect or /sync requests for the same user. The
//   express limiter doesn't help here because two near-simultaneous clicks
//   both pass the limit before either completes.
//
// Layer 3 — Per-user minimum sync interval (MIN_SYNC_INTERVAL_MS)
//   Refuses /sync if lastSyncedAt is too recent. The user-facing sync button
//   has nothing to gain from being clicked more often than this.
//
// Layer 4 — Fail-fast when lastError is set
//   If a previous sync failed (auth error, 429, anything), refuse to retry
//   automatically. Force the user to disconnect+reconnect explicitly. This
//   means each broken connection costs at most ONE failed login attempt.
//
// Layer 5 — Global 429 circuit breaker (garminCircuitBreaker)
//   If ANY Garmin call returns 429, freeze ALL Garmin operations across all
//   users on this instance for GLOBAL_429_COOLDOWN_MS. The official advice
//   from python-garminconnect is "wait 60 seconds" — we wait much longer
//   because we don't know how widely the ban will propagate.
//
// Layer 6 — No automatic re-login on stale tokens
//   Tokens are good for ~1 year. If a fresh-looking cached token unexpectedly
//   401s, we surface the error and require manual reconnect rather than
//   silently re-logging in. This caps the cost of a "weird" failure mode.
//
// Layer 7 — Audit logging
//   Every Garmin API call and login is logged at info level with the userId
//   so we can trace exactly what triggered a ban if one happens.
//
// =============================================================================

// How many activities to pull per /sync request. Garmin's getActivities()
// page size — kept small to limit bytes-on-wire and reduce the chance of a
// 429 retry storm.
const GARMIN_ACTIVITIES_PER_SYNC = 20;

// How long the global circuit breaker stays tripped after a 429. Generous
// because we don't know how widely the ban applies — better to wait too long
// than to keep poking and extend the ban.
const GLOBAL_429_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// Minimum gap between successful /sync calls for one user. The Sync button
// has no value in being clicked faster than this.
const MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Margin we keep against the cached OAuth2 expiry timestamp. Tokens within
// this window of expiring are treated as already expired so we don't race
// the boundary mid-call.
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

// Reject obviously-bad inputs at the boundary so we never round-trip them
// to Garmin's auth flow (which is the most rate-limited surface).
const garminConnectBodySchema = z.object({
  email: z.string().trim().email("Invalid email").max(254),
  password: z.string().min(1, "Password required").max(256),
});

// Layer 1 — Stricter than the Strava limiter because every login is a real
// Garmin SSO call: a few too many of these from our shared server IP can
// earn us a 429 ban for ALL users.
const garminConnectLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_15M_MS,
  max: 5,
  message: "Too many Garmin connect attempts, please try again after 15 minutes",
});

const garminSyncLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_15M_MS,
  max: 5,
  message: "Too many Garmin sync requests, please try again after 15 minutes",
});

// =============================================================================
// Layer 5 — Global 429 circuit breaker
// =============================================================================

const garminCircuitBreaker = {
  /** Unix-ms timestamp until which all Garmin operations are frozen. */
  blockedUntil: 0 as number,

  trip(reason: string): void {
    this.blockedUntil = Date.now() + GLOBAL_429_COOLDOWN_MS;
    logger.error(
      { context: "garmin", reason, until: new Date(this.blockedUntil).toISOString() },
      "Garmin circuit breaker tripped — freezing all Garmin operations",
    );
  },

  isOpen(): boolean {
    return Date.now() < this.blockedUntil;
  },

  remainingMs(): number {
    return Math.max(0, this.blockedUntil - Date.now());
  },

  // Exposed only for tests; never call from request handlers.
  _resetForTests(): void {
    this.blockedUntil = 0;
  },
};

/** Sniffs an unknown error to decide if it's a Garmin 429. */
function looksLike429(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return lower.includes("429") || lower.includes("too many") || lower.includes("rate limit");
}

/**
 * Wraps any Garmin API call with circuit-breaker tripping. If the call throws
 * something that looks like a 429, we trip the breaker BEFORE re-throwing so
 * the error reaches the route handler with the breaker already armed.
 */
async function withCircuitBreaker<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (garminCircuitBreaker.isOpen()) {
    throw new Error(
      `Garmin temporarily blocked us due to rate limits. Please try again in about ${Math.ceil(garminCircuitBreaker.remainingMs() / 60_000)} minutes.`,
    );
  }
  try {
    return await fn();
  } catch (err) {
    if (looksLike429(err)) {
      garminCircuitBreaker.trip(`${label} returned 429`);
    }
    throw err;
  }
}

// =============================================================================
// Layer 2 — Per-user in-flight mutex
// =============================================================================

const inFlightUsers = new Set<string>();

async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  if (inFlightUsers.has(userId)) {
    throw new Error("A Garmin operation is already in progress for your account. Please wait for it to finish.");
  }
  inFlightUsers.add(userId);
  try {
    return await fn();
  } finally {
    inFlightUsers.delete(userId);
  }
}

// =============================================================================
// Error translation
// =============================================================================

// Translate the various errors @flow-js/garmin-connect throws into messages
// the UI can show as-is. The lib has no error class hierarchy, so we sniff
// on the message text.
function translateGarminError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (looksLike429(err)) {
    return "Garmin temporarily blocked us due to rate limits. Please try again in about 30 minutes.";
  }
  if (lower.includes("401") || lower.includes("unauthor")) {
    return "Garmin rejected the credentials. Double-check your email and password, then disconnect and reconnect.";
  }
  if (
    lower.includes("ticket") ||
    lower.includes("csrf") ||
    lower.includes("mfa") ||
    lower.includes("2fa") ||
    lower.includes("verification")
  ) {
    // The library can't pass the SSO challenge when 2-step verification is
    // on. Be explicit so users know what to do.
    return "Garmin login failed. If you have 2-step verification enabled on your Garmin account, you must disable it temporarily — the sync library does not support MFA yet.";
  }
  return "Garmin login failed. Please disconnect and reconnect; if this persists, your Garmin account may require disabling 2-step verification.";
}

/**
 * Returns true when the cached OAuth2 token is present and not within the
 * expiry buffer. We deliberately leave a wide buffer to avoid races where
 * the token expires mid-call and the lib refuses to refresh.
 */
function tokensStillFresh(tokenExpiresAt: Date | null): boolean {
  if (!tokenExpiresAt) return false;
  return tokenExpiresAt.getTime() > Date.now() + TOKEN_EXPIRY_BUFFER_MS;
}

// =============================================================================
// Client construction
// =============================================================================

/**
 * Resolves to a logged-in GarminConnect client for the user.
 *
 * Strategy: heavy preference for cached tokens (which last ~1 year). We only
 * perform a fresh login when there are no cached tokens at all OR they're
 * within the expiry buffer. Notably we do NOT auto-relogin if a "fresh-looking"
 * token unexpectedly fails — that goes through the lastError path so the user
 * has to disconnect+reconnect manually. This caps the worst-case cost of any
 * Garmin-side weirdness to one wasted API call per Sync click.
 */
async function getGarminClient(userId: string, reqLog: typeof logger): Promise<GarminConnect> {
  const conn = await storage.users.getGarminConnection(userId);
  if (!conn) {
    throw new Error("Garmin not connected");
  }

  // Layer 4 — fail fast on broken connections.
  if (conn.lastError) {
    throw new Error(`${conn.lastError} (Disconnect and reconnect to retry.)`);
  }

  // Storage layer decrypts these in place — they hold plaintext after the
  // getGarminConnection() call. Naming the columns "encrypted*" is a
  // historical artifact of the Strava-style row shape.
  const email = conn.encryptedEmail;
  const password = conn.encryptedPassword;

  const client = new GarminConnect({ username: email, password });

  // Fast path: load cached tokens. If they fail at the next API call we
  // surface the error and require manual reconnect — we do NOT auto-relogin.
  if (
    tokensStillFresh(conn.tokenExpiresAt) &&
    conn.encryptedOauth1Token &&
    conn.encryptedOauth2Token
  ) {
    try {
      const oauth1 = JSON.parse(conn.encryptedOauth1Token) as IOauth1Token;
      const oauth2 = JSON.parse(conn.encryptedOauth2Token) as IOauth2Token;
      client.loadToken(oauth1, oauth2);
      reqLog.info({ userId, context: "garmin" }, "Using cached Garmin tokens");
      return client;
    } catch (err) {
      // Corrupted JSON in DB — fall through to fresh login.
      reqLog.warn({ err, userId, context: "garmin" }, "Failed to parse cached Garmin tokens, will re-login");
    }
  }

  // Slow path: full SSO login. This is the expensive call we want to avoid
  // at all costs. Wrapped in the circuit breaker because login failures are
  // the most common path to a 429.
  reqLog.info({ userId, context: "garmin" }, "Performing fresh Garmin login");
  try {
    await withCircuitBreaker("login", () => client.login(email, password));
  } catch (err) {
    const friendly = translateGarminError(err);
    await storage.users.setGarminError(userId, friendly);
    reqLog.error({ err, userId, context: "garmin" }, "Garmin login failed");
    throw new Error(friendly);
  }

  // Persist the freshly-minted tokens so subsequent /sync calls can skip
  // login entirely. exportToken() throws if tokens aren't set yet — but
  // we just successfully logged in, so this is safe.
  try {
    const tokens = client.exportToken();
    const tokenExpiresAtMs = (tokens.oauth2?.expires_at ?? 0) * 1000;
    await storage.users.updateGarminTokens(
      userId,
      JSON.stringify(tokens.oauth1),
      JSON.stringify(tokens.oauth2),
      tokenExpiresAtMs > 0 ? new Date(tokenExpiresAtMs) : null,
    );
    reqLog.info(
      { userId, context: "garmin", expiresAt: new Date(tokenExpiresAtMs).toISOString() },
      "Persisted fresh Garmin tokens",
    );
  } catch (err) {
    // Non-fatal — we'll just re-login on the next sync.
    reqLog.warn({ err, userId, context: "garmin" }, "Failed to persist Garmin tokens after login");
  }

  return client;
}

// =============================================================================
// Route handlers
// =============================================================================

async function handleGarminStatus(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    const conn = await storage.users.getGarminConnection(userId);

    if (!conn) {
      return res.json({ connected: false });
    }

    res.json({
      connected: true,
      garminDisplayName: conn.garminDisplayName,
      lastSyncedAt: conn.lastSyncedAt,
      lastError: conn.lastError,
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, "Garmin status error:");
    res.status(500).json({ error: "Failed to get Garmin status", code: "INTERNAL_SERVER_ERROR" });
  }
}

async function handleGarminConnect(req: Request, res: Response) {
  // Layer 5 — refuse before we even validate inputs if Garmin has us in jail.
  if (garminCircuitBreaker.isOpen()) {
    return res.status(503).json({
      error: `Garmin temporarily blocked us due to rate limits. Please try again in about ${Math.ceil(garminCircuitBreaker.remainingMs() / 60_000)} minutes.`,
      code: "GARMIN_CIRCUIT_OPEN",
    });
  }

  const parsed = garminConnectBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid request",
      code: "BAD_REQUEST",
    });
  }
  const { email, password } = parsed.data;

  const userId = getUserId(req);
  const reqLog = req.log || logger;

  try {
    await withUserLock(userId, async () => {
      // Try to log in BEFORE persisting credentials so we don't store anything
      // for a failed connection attempt.
      const client = new GarminConnect({ username: email, password });

      reqLog.info({ userId, context: "garmin" }, "Garmin /connect: starting fresh login");
      try {
        await withCircuitBreaker("connect.login", () => client.login(email, password));
      } catch (err) {
        const friendly = translateGarminError(err);
        reqLog.warn({ err, userId, context: "garmin" }, "Initial Garmin connect failed");
        res.status(401).json({ error: friendly, code: "GARMIN_AUTH_FAILED" });
        return;
      }

      let displayName: string | null = null;
      try {
        const profile = await withCircuitBreaker("connect.getUserProfile", () => client.getUserProfile());
        displayName = profile?.displayName ?? null;
      } catch (err) {
        // Profile lookup is optional — if it fails the connection is still valid.
        reqLog.warn({ err, userId, context: "garmin" }, "Garmin getUserProfile failed");
      }

      let oauth1Json: string | null = null;
      let oauth2Json: string | null = null;
      let tokenExpiresAt: Date | null = null;
      try {
        const tokens = client.exportToken();
        oauth1Json = JSON.stringify(tokens.oauth1);
        oauth2Json = JSON.stringify(tokens.oauth2);
        const expiresAtMs = (tokens.oauth2?.expires_at ?? 0) * 1000;
        if (expiresAtMs > 0) tokenExpiresAt = new Date(expiresAtMs);
      } catch (err) {
        reqLog.warn({ err, userId, context: "garmin" }, "Garmin exportToken failed after login");
      }

      await storage.users.upsertGarminConnection({
        userId,
        garminDisplayName: displayName,
        // Storage layer encrypts these — we pass plaintext.
        encryptedEmail: email,
        encryptedPassword: password,
        encryptedOauth1Token: oauth1Json,
        encryptedOauth2Token: oauth2Json,
        tokenExpiresAt,
        lastSyncedAt: null,
        lastError: null,
      });

      reqLog.info(
        { userId, context: "garmin", displayName, hasTokens: Boolean(oauth1Json) },
        "Garmin /connect succeeded",
      );

      res.json({ success: true, garminDisplayName: displayName });
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("already in progress")) {
      return res.status(409).json({ error: err.message, code: "GARMIN_BUSY" });
    }
    throw err;
  }
}

async function handleGarminDisconnect(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    await storage.users.deleteGarminConnection(userId);
    res.json({ success: true });
  } catch (error) {
    (req.log || logger).error({ err: error }, "Garmin disconnect error:");
    res.status(500).json({ error: "Failed to disconnect Garmin", code: "INTERNAL_SERVER_ERROR" });
  }
}

async function handleGarminSync(req: Request, res: Response) {
  // Layer 5 — global circuit breaker check (cheapest possible reject path).
  if (garminCircuitBreaker.isOpen()) {
    return res.status(503).json({
      error: `Garmin temporarily blocked us due to rate limits. Please try again in about ${Math.ceil(garminCircuitBreaker.remainingMs() / 60_000)} minutes.`,
      code: "GARMIN_CIRCUIT_OPEN",
    });
  }

  const userId = getUserId(req);
  const reqLog = req.log || logger;

  // Layer 3 — minimum sync interval. Read the connection once up front so we
  // can enforce the cooldown without paying for any Garmin call.
  const existing = await storage.users.getGarminConnection(userId);
  if (!existing) {
    return res.status(404).json({ error: "Garmin not connected", code: "GARMIN_NOT_CONNECTED" });
  }
  if (existing.lastSyncedAt) {
    const sinceLastMs = Date.now() - existing.lastSyncedAt.getTime();
    if (sinceLastMs < MIN_SYNC_INTERVAL_MS) {
      const waitMin = Math.ceil((MIN_SYNC_INTERVAL_MS - sinceLastMs) / 60_000);
      return res.status(429).json({
        error: `Please wait ${waitMin} more minute${waitMin === 1 ? "" : "s"} before syncing again.`,
        code: "GARMIN_SYNC_TOO_SOON",
      });
    }
  }
  // Layer 4 — fail-fast on broken connection. Don't even try to log in.
  if (existing.lastError) {
    return res.status(401).json({
      error: `${existing.lastError} (Disconnect and reconnect to retry.)`,
      code: "GARMIN_RECONNECT_REQUIRED",
    });
  }

  try {
    await withUserLock(userId, async () => {
      let client: GarminConnect;
      try {
        client = await getGarminClient(userId, reqLog);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Garmin sync failed";
        res.status(401).json({ error: message, code: "GARMIN_AUTH_FAILED" });
        return;
      }

      let activities: GarminActivity[];
      try {
        reqLog.info({ userId, context: "garmin", limit: GARMIN_ACTIVITIES_PER_SYNC }, "Garmin getActivities");
        // The library types getActivities() as Promise<IActivity[]> with ~150
        // fields, most typed as `unknown`. We narrow to our GarminActivity
        // subset at the boundary.
        activities = (await withCircuitBreaker("getActivities", () =>
          client.getActivities(0, GARMIN_ACTIVITIES_PER_SYNC),
        )) as unknown as GarminActivity[];
      } catch (err) {
        const friendly = translateGarminError(err);
        await storage.users.setGarminError(userId, friendly);
        reqLog.error({ err, userId, context: "garmin" }, "Garmin getActivities failed");
        res.status(502).json({ error: friendly, code: "GARMIN_API_ERROR" });
        return;
      }

      if (!Array.isArray(activities)) {
        res.status(502).json({ error: "Garmin returned an unexpected response", code: "GARMIN_API_ERROR" });
        return;
      }

      const user = await storage.users.getUser(userId);
      const distanceUnit = (user?.distanceUnit || "km") as DistanceUnit;

      const activityIds = activities.map((a) => String(a.activityId));
      const existingIds = await storage.workouts.getExistingGarminActivityIds(userId, activityIds);
      const existingSet = new Set(existingIds);

      let skipped = 0;
      const workoutsToImport = [];

      for (const activity of activities) {
        if (existingSet.has(String(activity.activityId))) {
          skipped++;
          continue;
        }
        workoutsToImport.push(mapGarminActivityToWorkout(activity, userId, distanceUnit));
      }

      if (workoutsToImport.length > 0) {
        await storage.workouts.createGarminWorkoutLogs(workoutsToImport);
      }
      const imported = workoutsToImport.length;

      await storage.users.updateGarminLastSync(userId);

      reqLog.info(
        { userId, context: "garmin", imported, skipped, total: activities.length },
        "Garmin /sync succeeded",
      );

      res.json({
        success: true,
        imported,
        skipped,
        total: activities.length,
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("already in progress")) {
      return res.status(409).json({ error: err.message, code: "GARMIN_BUSY" });
    }
    throw err;
  }
}

export function registerGarminRoutes(app: Express): void {
  app.get("/api/v1/garmin/status", isAuthenticated, asyncHandler(handleGarminStatus));
  app.post(
    "/api/v1/garmin/connect",
    ...protectedMutationGuards,
    garminConnectLimiter,
    asyncHandler(handleGarminConnect),
  );
  app.delete("/api/v1/garmin/disconnect", ...protectedMutationGuards, asyncHandler(handleGarminDisconnect));
  app.post("/api/v1/garmin/sync", ...protectedMutationGuards, garminSyncLimiter, asyncHandler(handleGarminSync));
}

// Exported for tests only.
export const __testing = {
  garminCircuitBreaker,
  inFlightUsers,
  GLOBAL_429_COOLDOWN_MS,
  MIN_SYNC_INTERVAL_MS,
  TOKEN_EXPIRY_BUFFER_MS,
  GARMIN_ACTIVITIES_PER_SYNC,
};
