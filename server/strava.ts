import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { isAuthenticated } from "./replitAuth";

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI = process.env.REPLIT_DOMAINS 
  ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}/api/strava/callback`
  : "http://localhost:5000/api/strava/callback";

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

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string;
  start_date_local: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_speed: number;
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
}

async function refreshStravaToken(refreshToken: string): Promise<StravaTokenResponse | null> {
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    console.error("Strava credentials not configured");
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
      console.error("Failed to refresh Strava token:", await response.text());
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("Error refreshing Strava token:", error);
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

function formatDistance(meters: number): string {
  const km = meters / 1000;
  return `${km.toFixed(2)} km`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function mapStravaActivityToWorkout(activity: StravaActivity, userId: string) {
  const durationMinutes = Math.round(activity.moving_time / 60);
  const mainWorkout = `${formatDistance(activity.distance)}, ${formatDuration(activity.moving_time)}`;
  const accessory = activity.total_elevation_gain > 0 
    ? `Elevation: ${Math.round(activity.total_elevation_gain)}m` 
    : null;

  return {
    userId,
    date: activity.start_date_local.split("T")[0],
    focus: activity.sport_type || activity.type || "Workout",
    mainWorkout,
    accessory,
    notes: activity.name,
    duration: durationMinutes,
    rpe: null,
    planDayId: null,
    source: "strava" as const,
    stravaActivityId: String(activity.id),
  };
}

export function registerStravaRoutes(app: Express): void {
  app.get("/api/strava/status", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.user.claims.sub;
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
      console.error("Strava status error:", error);
      res.status(500).json({ error: "Failed to get Strava status" });
    }
  });

  app.get("/api/strava/auth", isAuthenticated, async (req: any, res: Response) => {
    if (!STRAVA_CLIENT_ID) {
      return res.status(500).json({ error: "Strava integration not configured" });
    }

    const userId = req.user.claims.sub;
    const scope = "activity:read_all";
    
    const authUrl = new URL("https://www.strava.com/oauth/authorize");
    authUrl.searchParams.set("client_id", STRAVA_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", STRAVA_REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scope);
    authUrl.searchParams.set("state", userId);

    res.json({ authUrl: authUrl.toString() });
  });

  app.get("/api/strava/callback", async (req: Request, res: Response) => {
    const { code, state: userId, error: stravaError } = req.query;

    if (stravaError) {
      console.error("Strava auth error:", stravaError);
      return res.redirect("/settings?strava=error");
    }

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
        console.error("Token exchange failed:", await tokenResponse.text());
        return res.redirect("/settings?strava=error");
      }

      const tokenData: StravaTokenResponse = await tokenResponse.json();

      await storage.upsertStravaConnection({
        userId: userId as string,
        stravaAthleteId: String(tokenData.athlete.id),
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: new Date(tokenData.expires_at * 1000),
        scope: "activity:read_all",
        lastSyncedAt: null,
      });

      res.redirect("/settings?strava=connected");
    } catch (error) {
      console.error("Strava callback error:", error);
      res.redirect("/settings?strava=error");
    }
  });

  app.delete("/api/strava/disconnect", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.user.claims.sub;
      await storage.deleteStravaConnection(userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Strava disconnect error:", error);
      res.status(500).json({ error: "Failed to disconnect Strava" });
    }
  });

  app.post("/api/strava/sync", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.user.claims.sub;
      const accessToken = await getValidAccessToken(userId);

      if (!accessToken) {
        return res.status(401).json({ error: "Strava not connected or token expired" });
      }

      const activitiesResponse = await fetch(
        "https://www.strava.com/api/v3/athlete/activities?per_page=30",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!activitiesResponse.ok) {
        console.error("Failed to fetch Strava activities:", await activitiesResponse.text());
        return res.status(500).json({ error: "Failed to fetch activities from Strava" });
      }

      const activities: StravaActivity[] = await activitiesResponse.json();
      let imported = 0;
      let skipped = 0;

      for (const activity of activities) {
        const existingLog = await storage.getWorkoutByStravaActivityId(userId, String(activity.id));
        
        if (existingLog) {
          skipped++;
          continue;
        }

        const workoutData = mapStravaActivityToWorkout(activity, userId);
        await storage.createWorkoutLog(workoutData);
        imported++;
      }

      await storage.updateStravaLastSync(userId);

      res.json({
        success: true,
        imported,
        skipped,
        total: activities.length,
      });
    } catch (error) {
      console.error("Strava sync error:", error);
      res.status(500).json({ error: "Failed to sync Strava activities" });
    }
  });
}
