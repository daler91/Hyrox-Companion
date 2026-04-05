import { env } from "./env";
import { logger } from "./logger";
import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { storage } from "./storage";
import { isAuthenticated } from "./clerkAuth";
import { type DistanceUnit } from "@shared/unitConversion";
import { mapStravaActivityToWorkout, type StravaActivity } from "./services/stravaMapper";
import { getUserId } from "./types";
import { asyncHandler } from "./routeUtils";
import { retryWithJitter, RetryableHttpError, parseRetryAfter } from "./utils/httpRetry";
import rateLimit from "express-rate-limit";
import { RATE_LIMIT_WINDOW_15M_MS, STRAVA_STATE_MAX_AGE_MS, EXTERNAL_API_TIMEOUT_MS } from "./constants";

const STRAVA_CLIENT_ID = env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI = env.APP_URL
  ? `${env.APP_URL}/api/v1/strava/callback`
  : "http://localhost:5000/api/v1/strava/callback";

const STATE_SECRET = env.STRAVA_STATE_SECRET || crypto.randomBytes(32).toString("hex");
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
  athlete: {
    id: number;
    username: string;
    firstname: string;
    lastname: string;
  };
}

async function refreshStravaToken(refreshToken: string): Promise<StravaTokenResponse | null> {
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    logger.error("Strava credentials not configured");
    return null;
  }

  try {
    return await retryWithJitter(
      async () => {
        const response = await fetch("https://www.strava.com/oauth/token", {
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
          logger.error({ err: await response.text(), status: response.status }, "Failed to refresh Strava token:");
          return null;
        }
        return (await response.json()) as StravaTokenResponse;
      },
      { label: "strava.refreshToken", retries: 3 },
    );
  } catch (error) {
    logger.error({ err: error }, "Error refreshing Strava token:");
    return null;
  }
}

async function getValidAccessToken(userId: string): Promise<string | null> {
  const connection = await storage.users.getStravaConnection(userId);
  if (!connection) return null;

  const now = new Date();
  if (connection.expiresAt > now) {
    return connection.accessToken;
  }

  const refreshed = await refreshStravaToken(connection.refreshToken);
  if (!refreshed) return null;

  await storage.users.upsertStravaConnection({
    userId,
    stravaAthleteId: connection.stravaAthleteId,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    expiresAt: new Date(refreshed.expires_at * 1000),
    scope: connection.scope,
    lastSyncedAt: connection.lastSyncedAt,
  });

  return refreshed.access_token;
}

async function handleStravaStatus(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    const connection = await storage.users.getStravaConnection(userId);

    if (!connection) {
      return res.json({ connected: false });
    }

    res.json({
      connected: true,
      athleteId: connection.stravaAthleteId,
      lastSyncedAt: connection.lastSyncedAt,
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, "Strava status error:");
    res.status(500).json({ error: "Failed to get Strava status", code: "INTERNAL_SERVER_ERROR" });
  }
}

async function handleStravaAuth(req: Request, res: Response) {
  if (!STRAVA_CLIENT_ID) {
    return res.status(500).json({ error: "Strava integration not configured", code: "INTERNAL_SERVER_ERROR" });
  }

  const userId = getUserId(req);
  const scope = "activity:read_all";

  const state = createSignedState(userId);

  const authUrl = new URL("https://www.strava.com/oauth/authorize");
  authUrl.searchParams.set("client_id", STRAVA_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", STRAVA_REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("state", state);

  res.json({ authUrl: authUrl.toString() });
}

async function handleStravaCallback(req: Request, res: Response) {
  const { code, state, error: stravaError } = req.query;

  if (stravaError) {
    (req.log || logger).error("Strava auth error received from provider");
    return res.redirect("/settings?strava=error");
  }

  if (typeof state !== "string" || typeof code !== "string") {
    (req.log || logger).error("Strava OAuth callback received invalid query params");
    return res.redirect("/settings?strava=error");
  }

  const verified = verifySignedState(state);
  if (!verified) {
    (req.log || logger).error("Strava OAuth state invalid or expired - possible CSRF attack");
    return res.redirect("/settings?strava=error");
  }

  const userId = verified.userId;

  if (!userId || !STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    return res.redirect("/settings?strava=error");
  }

  try {
    const tokenResponse = await fetch("https://www.strava.com/oauth/token", {
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

    if (!tokenResponse.ok) {
      (req.log || logger).error({ err: await tokenResponse.text() }, "Token exchange failed:");
      return res.redirect("/settings?strava=error");
    }

    const tokenData = (await tokenResponse.json()) as StravaTokenResponse;

    await storage.users.upsertStravaConnection({
      userId,
      stravaAthleteId: String(tokenData.athlete.id),
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(tokenData.expires_at * 1000),
      scope: "activity:read_all",
      lastSyncedAt: null,
    });

    res.redirect("/settings?strava=connected");
  } catch (error) {
    (req.log || logger).error({ err: error }, "Strava callback error:");
    res.redirect("/settings?strava=error");
  }
}

async function handleStravaDisconnect(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    await storage.users.deleteStravaConnection(userId);
    res.json({ success: true });
  } catch (error) {
    (req.log || logger).error({ err: error }, "Strava disconnect error:");
    res.status(500).json({ error: "Failed to disconnect Strava", code: "INTERNAL_SERVER_ERROR" });
  }
}

async function handleStravaSync(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    const accessToken = await getValidAccessToken(userId);

    if (!accessToken) {
      return res.status(401).json({ error: "Strava not connected or token expired", code: "UNAUTHORIZED" });
    }

    const user = await storage.users.getUser(userId);
    const distanceUnit = (user?.distanceUnit || "km") as DistanceUnit;

    let activities: StravaActivity[];
    try {
      activities = await retryWithJitter(
        async () => {
          const activitiesResponse = await fetch(
            "https://www.strava.com/api/v3/athlete/activities?per_page=30",
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
            },
          );

          if (activitiesResponse.status === 429 || activitiesResponse.status >= 500) {
            throw new RetryableHttpError(
              activitiesResponse.status,
              parseRetryAfter(activitiesResponse.headers.get("retry-after")),
            );
          }
          if (!activitiesResponse.ok) {
            (req.log || logger).error(
              { err: await activitiesResponse.text(), status: activitiesResponse.status },
              "Failed to fetch Strava activities:",
            );
            throw new Error(`Strava activities request failed: ${activitiesResponse.status}`);
          }
          return (await activitiesResponse.json()) as StravaActivity[];
        },
        { label: "strava.listActivities", retries: 3 },
      );
    } catch (err) {
      (req.log || logger).error({ err }, "Failed to fetch Strava activities after retries:");
      return res.status(500).json({ error: "Failed to fetch activities from Strava", code: "INTERNAL_SERVER_ERROR" });
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
      await storage.workouts.createWorkoutLogs(workoutsToImport);
    }
    const imported = workoutsToImport.length;

    await storage.users.updateStravaLastSync(userId);

    res.json({
      success: true,
      imported,
      skipped,
      total: activities.length,
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, "Strava sync error:");
    res.status(500).json({ error: "Failed to sync Strava activities", code: "INTERNAL_SERVER_ERROR" });
  }
}

export function registerStravaRoutes(app: Express): void {
  app.get("/api/v1/strava/status", isAuthenticated, asyncHandler(handleStravaStatus));
  app.get("/api/v1/strava/auth", isAuthenticated, stravaAuthLimiter, asyncHandler(handleStravaAuth));
  app.get("/api/v1/strava/callback", stravaAuthLimiter, asyncHandler(handleStravaCallback));
  app.delete("/api/v1/strava/disconnect", isAuthenticated, asyncHandler(handleStravaDisconnect));
  app.post("/api/v1/strava/sync", isAuthenticated, stravaSyncLimiter, asyncHandler(handleStravaSync));
}
