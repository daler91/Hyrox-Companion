import { env } from "./env";
import { logger } from "./logger";
import type { Express, Response } from "express";
import crypto from "node:crypto";
import { storage } from "./storage";
import { isAuthenticated } from "./clerkAuth";
import { type DistanceUnit } from "@shared/unitConversion";
import { mapStravaActivityToWorkout, type StravaActivity } from "./services/stravaMapper";
import { getUserId } from "./types";
import { rateLimiter } from "./routeUtils";

const STRAVA_CLIENT_ID = env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI = env.REPLIT_DOMAINS
  ? `https://${env.REPLIT_DOMAINS.split(",")[0]}/api/strava/callback`
  : "http://localhost:5000/api/strava/callback";

const STATE_SECRET = env.CLERK_SECRET_KEY || crypto.randomBytes(32).toString("hex");

const stravaAuthLimiter = rateLimiter("stravaAuth", 20, 15 * 60 * 1000); // 20 requests per 15 minutes
const STATE_MAX_AGE_MS = 10 * 60 * 1000;


export function createSignedState(userId: string): string {
  const timestamp = Date.now().toString(36);
  const nonce = crypto.randomBytes(8).toString("hex");
  const payload = `${userId}:${timestamp}:${nonce}`;
  const signature = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("hex").slice(0, 16);
  return `${payload}:${signature}`;
}

export function verifySignedState(state: string): { userId: string } | null {
  const parts = state.split(":");
  if (parts.length !== 4) return null;
  const [userId, timestamp, nonce, signature] = parts;
  const payload = `${userId}:${timestamp}:${nonce}`;
  const expected = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("hex").slice(0, 16);

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
    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      logger.error({ err: await response.text() }, "Failed to refresh Strava token:");
      return null;
    }

    return await response.json();
  } catch (error) {
    logger.error({ err: error }, "Error refreshing Strava token:");
    return null;
  }
}

async function getValidAccessToken(userId: string): Promise<string | null> {
  const connection = await storage.getStravaConnection(userId);
  if (!connection) return null;

  const now = new Date();
  if (connection.expiresAt > now) {
    return connection.accessToken;
  }

  const refreshed = await refreshStravaToken(connection.refreshToken);
  if (!refreshed) return null;

  await storage.upsertStravaConnection({
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

export function registerStravaRoutes(app: Express): void {
  app.get("/api/v1/strava/status", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = getUserId(req);
      const connection = await storage.getStravaConnection(userId);

      if (!connection) {
        return res.json({ connected: false });
      }

      res.json({
        connected: true,
        athleteId: connection.stravaAthleteId,
        lastSyncedAt: connection.lastSyncedAt,
      });
    } catch (error) {
      logger.error({ err: error }, "Strava status error:");
      res.status(500).json({ error: "Failed to get Strava status" });
    }
  });

  app.get("/api/v1/strava/auth", isAuthenticated, stravaAuthLimiter, async (req: any, res: Response) => {
    if (!STRAVA_CLIENT_ID) {
      return res.status(500).json({ error: "Strava integration not configured" });
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
  });

  app.get("/api/v1/strava/callback", stravaAuthLimiter, async (req: any, res: Response) => {
    const { code, state, error: stravaError } = req.query;

    if (stravaError) {
      logger.error("Strava auth error received from provider");
      return res.redirect("/settings?strava=error");
    }

    const verified = verifySignedState(state as string);
    if (!verified) {
      logger.error("Strava OAuth state invalid or expired - possible CSRF attack");
      return res.redirect("/settings?strava=error");
    }

    const userId = verified.userId;

    if (!code || !userId || !STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
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
      });

      if (!tokenResponse.ok) {
        logger.error({ err: await tokenResponse.text() }, "Token exchange failed:");
        return res.redirect("/settings?strava=error");
      }

      const tokenData: StravaTokenResponse = await tokenResponse.json();

      await storage.upsertStravaConnection({
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
      logger.error({ err: error }, "Strava callback error:");
      res.redirect("/settings?strava=error");
    }
  });

  app.delete("/api/v1/strava/disconnect", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = getUserId(req);
      await storage.deleteStravaConnection(userId);
      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error }, "Strava disconnect error:");
      res.status(500).json({ error: "Failed to disconnect Strava" });
    }
  });

  app.post("/api/v1/strava/sync", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = getUserId(req);
      const accessToken = await getValidAccessToken(userId);

      if (!accessToken) {
        return res.status(401).json({ error: "Strava not connected or token expired" });
      }

      const user = await storage.getUser(userId);
      const distanceUnit = (user?.distanceUnit || "km") as DistanceUnit;

      const activitiesResponse = await fetch(
        "https://www.strava.com/api/v3/athlete/activities?per_page=30",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!activitiesResponse.ok) {
        logger.error({ err: await activitiesResponse.text() }, "Failed to fetch Strava activities:");
        return res.status(500).json({ error: "Failed to fetch activities from Strava" });
      }

      const activities: StravaActivity[] = await activitiesResponse.json();

      const activityIds = activities.map(a => String(a.id));
      const existingWorkouts = await storage.getWorkoutsByStravaActivityIds(userId, activityIds);
      const existingStravaIds = new Set(existingWorkouts.map(w => w.stravaActivityId));

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
        await storage.createWorkoutLogs(workoutsToImport);
      }
      const imported = workoutsToImport.length;

      await storage.updateStravaLastSync(userId);

      res.json({
        success: true,
        imported,
        skipped,
        total: activities.length,
      });
    } catch (error) {
      logger.error({ err: error }, "Strava sync error:");
      res.status(500).json({ error: "Failed to sync Strava activities" });
    }
  });
}
