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

// How many activities to pull per /sync request. Garmin's getActivities()
// page size — kept small to avoid 429s.
const GARMIN_ACTIVITIES_PER_SYNC = 30;

// Reject obviously-bad inputs at the boundary so we never round-trip them
// to Garmin's auth flow (which is the most rate-limited surface).
const garminConnectBodySchema = z.object({
  email: z.string().trim().email("Invalid email").max(254),
  password: z.string().min(1, "Password required").max(256),
});

// Stricter than the Strava limiter because every login is a real Garmin
// SSO call: a few too many of these from our shared server IP can earn us
// a 429 ban for ALL users.
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

// Translate the various errors @flow-js/garmin-connect throws into messages
// the UI can show as-is. The lib has no error class hierarchy, so we sniff
// on the message text. The biggest bucket is "anything that looks like a
// login failure" — we recommend disabling Garmin 2-step verification because
// the library doesn't support MFA at all.
function translateGarminError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("429") || lower.includes("too many")) {
    return "Garmin temporarily blocked us due to rate limits. Please try again in 15-30 minutes.";
  }
  if (lower.includes("401") || lower.includes("unauthor")) {
    return "Garmin rejected the credentials. Double-check your email and password.";
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
  return "Garmin login failed. Please try reconnecting; if this persists, your Garmin account may require disabling 2-step verification.";
}

/**
 * Returns true when the cached OAuth2 token is present and not within 60s
 * of expiry. We refuse to use a token expiring imminently because the next
 * Garmin call would race the expiry and throw mid-flight.
 */
function tokensStillFresh(tokenExpiresAt: Date | null): boolean {
  if (!tokenExpiresAt) return false;
  return tokenExpiresAt.getTime() > Date.now() + 60_000;
}

/**
 * Resolves to a logged-in GarminConnect client for the user. Reuses cached
 * OAuth tokens when fresh; falls back to a full login when expired or absent.
 * On any login failure, persists a friendly error message and re-throws.
 *
 * Callers should treat any thrown error as "user must reconnect" and surface
 * the connection's `lastError` field via /api/v1/garmin/status.
 */
async function getGarminClient(userId: string): Promise<GarminConnect> {
  const conn = await storage.users.getGarminConnection(userId);
  if (!conn) {
    throw new Error("Garmin not connected");
  }

  // Storage layer decrypts these in place — they hold plaintext after the
  // getGarminConnection() call. Naming the columns "encrypted*" is a
  // historical artifact of the Strava-style row shape.
  const email = conn.encryptedEmail;
  const password = conn.encryptedPassword;

  const client = new GarminConnect({ username: email, password });

  // Fast path: load cached tokens and assume they work. If the next call
  // 401s, the caller will fall through to a full re-login.
  if (
    tokensStillFresh(conn.tokenExpiresAt) &&
    conn.encryptedOauth1Token &&
    conn.encryptedOauth2Token
  ) {
    try {
      const oauth1 = JSON.parse(conn.encryptedOauth1Token) as IOauth1Token;
      const oauth2 = JSON.parse(conn.encryptedOauth2Token) as IOauth2Token;
      client.loadToken(oauth1, oauth2);
      return client;
    } catch (err) {
      // Corrupted JSON in DB — fall through to fresh login.
      logger.warn({ err, userId, context: "garmin" }, "Failed to parse cached Garmin tokens, will re-login");
    }
  }

  try {
    await client.login(email, password);
  } catch (err) {
    const friendly = translateGarminError(err);
    await storage.users.setGarminError(userId, friendly);
    logger.error({ err, userId, context: "garmin" }, "Garmin login failed");
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
  } catch (err) {
    // Non-fatal — we'll just re-login on the next sync.
    logger.warn({ err, userId, context: "garmin" }, "Failed to persist Garmin tokens after login");
  }

  return client;
}

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
  const parsed = garminConnectBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid request",
      code: "BAD_REQUEST",
    });
  }
  const { email, password } = parsed.data;

  const userId = getUserId(req);

  // Try to log in BEFORE persisting credentials so we don't store anything
  // for a failed connection attempt.
  const client = new GarminConnect({ username: email, password });
  try {
    await client.login(email, password);
  } catch (err) {
    const friendly = translateGarminError(err);
    (req.log || logger).warn({ err, userId, context: "garmin" }, "Initial Garmin connect failed");
    return res.status(401).json({ error: friendly, code: "GARMIN_AUTH_FAILED" });
  }

  let displayName: string | null = null;
  try {
    const profile = await client.getUserProfile();
    displayName = profile?.displayName ?? null;
  } catch (err) {
    // Profile lookup is optional — if it fails the connection is still valid.
    (req.log || logger).warn({ err, userId, context: "garmin" }, "Garmin getUserProfile failed");
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
    (req.log || logger).warn({ err, userId, context: "garmin" }, "Garmin exportToken failed after login");
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

  res.json({ success: true, garminDisplayName: displayName });
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
  const userId = getUserId(req);

  let client: GarminConnect;
  try {
    client = await getGarminClient(userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Garmin sync failed";
    return res.status(401).json({ error: message, code: "GARMIN_AUTH_FAILED" });
  }

  let activities: GarminActivity[];
  try {
    // The library types getActivities() as Promise<IActivity[]> with ~150
    // fields, most typed as `unknown`. We narrow to our GarminActivity
    // subset at the boundary.
    activities = (await client.getActivities(0, GARMIN_ACTIVITIES_PER_SYNC)) as unknown as GarminActivity[];
  } catch (err) {
    const friendly = translateGarminError(err);
    await storage.users.setGarminError(userId, friendly);
    (req.log || logger).error({ err, userId, context: "garmin" }, "Garmin getActivities failed");
    return res.status(502).json({ error: friendly, code: "GARMIN_API_ERROR" });
  }

  if (!Array.isArray(activities)) {
    return res.status(502).json({ error: "Garmin returned an unexpected response", code: "GARMIN_API_ERROR" });
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

  res.json({
    success: true,
    imported,
    skipped,
    total: activities.length,
  });
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
