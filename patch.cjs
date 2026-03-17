const fs = require('fs');
const content = fs.readFileSync('server/strava.ts', 'utf-8');

const newContent = content.replace(/export function registerStravaRoutes\(app: Express\): void \{[\s\S]*\}\s*$/, `
async function handleStravaStatus(req: any, res: Response) {
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
}

async function handleStravaAuth(req: any, res: Response) {
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
}

async function handleStravaCallback(req: any, res: Response) {
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
}

async function handleStravaDisconnect(req: any, res: Response) {
  try {
    const userId = getUserId(req);
    await storage.deleteStravaConnection(userId);
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Strava disconnect error:");
    res.status(500).json({ error: "Failed to disconnect Strava" });
  }
}

async function handleStravaSync(req: any, res: Response) {
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
        headers: { Authorization: \`Bearer \${accessToken}\` },
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
}

export function registerStravaRoutes(app: Express): void {
  app.get("/api/strava/status", isAuthenticated, handleStravaStatus);
  app.get("/api/strava/auth", isAuthenticated, stravaAuthLimiter, handleStravaAuth);
  app.get("/api/strava/callback", stravaAuthLimiter, handleStravaCallback);
  app.delete("/api/strava/disconnect", isAuthenticated, handleStravaDisconnect);
  app.post("/api/strava/sync", isAuthenticated, handleStravaSync);
}
`);
fs.writeFileSync('server/strava.ts', newContent);
