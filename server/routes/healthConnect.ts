import { type HealthConnectSyncInput,healthConnectSyncSchema } from "@shared/schema";
import { type Request as ExpressRequest, type Response, Router } from "express";

import { rateLimiter, validateBody } from "../routeUtils";
import { invalidateAnalyticsCachesForUser } from "../services/analyticsRouteCache";
import { importHealthConnectSessions } from "../services/healthConnectImport";
import { getUserId } from "../types";
import { protectedPost } from "./_helpers/protectedRouteBuilder";

const router = Router();

// The Android app's Health Connect sync: sessions read since its last Changes
// API token, and the ids deleted there. See services/healthConnectImport.ts.
protectedPost(
  router,
  "/api/v1/health-connect/sync",
  { limiter: rateLimiter("healthConnect", 30), middleware: [validateBody(healthConnectSyncSchema)] },
  async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const result = await importHealthConnectSessions(userId, req.body as HealthConnectSyncInput);
    if (result.imported > 0 || result.deleted > 0) invalidateAnalyticsCachesForUser(userId);
    res.json(result);
  },
);

export default router;
