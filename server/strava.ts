import type { Express, Request, Response } from "express";
import crypto from "crypto";
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
  average_cadence?: number;
  average_watts?: number;
  kilojoules?: number;
  calories?: number;
  suffer_score?: number;
  pr_count?: number;
  achievement_count?: number;
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

function formatDistance(meters: number, distanceUnit: string = "km"): string {
  if (distanceUnit === "miles") {
    const miles = meters / 1609.344;
    return `${miles.toFixed(2)} mi`;
  }
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

function formatPace(metersPerSecond: number, distanceUnit: string = "km"): string {
  if (metersPerSecond <= 0) return "";
  if (distanceUnit === "miles") {
    // Convert m/s to min/mile
    const minPerMile = (1609.344 / metersPerSecond) / 60;
    const mins = Math.floor(minPerMile);
    const secs = Math.round((minPerMile - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, "0")} /mi`;
  }
  // Convert m/s to min/km
  const minPerKm = (1000 / metersPerSecond) / 60;
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")} /km`;
}

function mapStravaActivityToWorkout(activity: StravaActivity, userId: string, distanceUnit: string = "km") {
  const durationMinutes = Math.round(activity.moving_time / 60);
  
  // Check if this is a distance-based activity (more than 100m)
  const isDistanceActivity = activity.distance > 100;
  
  const mainWorkout = isDistanceActivity
    ? `${formatDistance(activity.distance, distanceUnit)}, ${formatDuration(activity.moving_time)}`
    : `${formatDuration(activity.moving_time)} session`;
  
  // Build accessory info with elevation and pace if available
  const accessoryParts: string[] = [];
  if (activity.total_elevation_gain > 0) {
    const elevationUnit = distanceUnit === "miles" ? "ft" : "m";
    const elevation = distanceUnit === "miles" 
      ? Math.round(activity.total_elevation_gain * 3.28084)
      : Math.round(activity.total_elevation_gain);
    accessoryParts.push(`Elevation: ${elevation}${elevationUnit}`);
  }
  if (isDistanceActivity && activity.average_speed > 0) {
    accessoryParts.push(`Pace: ${formatPace(activity.average_speed, distanceUnit)}`);
  }
  const accessory = accessoryParts.length > 0 ? accessoryParts.join(" | ") : null;

  // Build notes with activity name and heartrate data (so user can edit it)
  const notesParts: string[] = [];
  if (activity.name) {
    notesParts.push(activity.name);
  }
  if (activity.average_heartrate) {
    const hrText = activity.max_heartrate 
      ? `Avg HR: ${Math.round(activity.average_heartrate)} bpm (max ${Math.round(activity.max_heartrate)})`
      : `Avg HR: ${Math.round(activity.average_heartrate)} bpm`;
    notesParts.push(hrText);
  }
  const notes = notesParts.length > 0 ? notesParts.join(" | ") : null;

  return {
    userId,
    date: activity.start_date_local.split("T")[0],
    focus: activity.sport_type || activity.type || "Workout",
    mainWorkout,
    accessory,
    notes,
    duration: durationMinutes,
    rpe: null,
    planDayId: null,
    source: "strava" as const,
    stravaActivityId: String(activity.id),
    // Detailed Strava metrics
    calories: activity.calories || activity.kilojoules ? Math.round((activity.calories || 0) || (activity.kilojoules || 0) * 0.239) : null,
    distanceMeters: activity.distance || null,
    elevationGain: activity.total_elevation_gain || null,
    avgHeartrate: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
    maxHeartrate: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
    avgSpeed: activity.average_speed || null,
    maxSpeed: activity.max_speed || null,
    avgCadence: activity.average_cadence || null,
    avgWatts: activity.average_watts ? Math.round(activity.average_watts) : null,
    sufferScore: activity.suffer_score || null,
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
    
    // Generate CSRF state token combining userId and random bytes
    const csrfToken = crypto.randomBytes(16).toString("hex");
    const state = `${userId}:${csrfToken}`;
    
    // Store CSRF token in session for validation
    req.session.stravaOAuthState = state;
    
    const authUrl = new URL("https://www.strava.com/oauth/authorize");
    authUrl.searchParams.set("client_id", STRAVA_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", STRAVA_REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scope);
    authUrl.searchParams.set("state", state);

    res.json({ authUrl: authUrl.toString() });
  });

  app.get("/api/strava/callback", async (req: any, res: Response) => {
    const { code, state, error: stravaError } = req.query;

    if (stravaError) {
      console.error("Strava auth error:", stravaError);
      return res.redirect("/settings?strava=error");
    }

    // Validate CSRF state token
    if (!state || !req.session?.stravaOAuthState || state !== req.session.stravaOAuthState) {
      console.error("Strava OAuth state mismatch - possible CSRF attack");
      return res.redirect("/settings?strava=error");
    }

    // Extract userId from state (format: userId:csrfToken)
    const userId = (state as string).split(":")[0];
    
    // Clear the state from session after validation
    delete req.session.stravaOAuthState;

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

      // Fetch user preferences for distance unit
      const user = await storage.getUser(userId);
      const distanceUnit = user?.distanceUnit || "km";

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

        const workoutData = mapStravaActivityToWorkout(activity, userId, distanceUnit);
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
