import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { DEFAULT_TIMELINE_LIMIT } from "../../constants";
import { asyncHandler, rateLimiter } from "../../routeUtils";
import { parseOffsetPagination } from "../../pagination";
import { storage } from "../../storage";
import { getUserId } from "../../types";

export function registerWorkoutTimelineRoutes(router: Router): void {
  router.get("/api/v1/timeline", isAuthenticated, rateLimiter("timeline", 60), asyncHandler(async (req: Request<Record<string, never>, Record<string, never>, Record<string, never>, { planId?: string; limit?: string; offset?: string }>, res: Response) => {
    const userId = getUserId(req);
    const pagination = parseOffsetPagination(req.query, { defaultLimit: DEFAULT_TIMELINE_LIMIT, maxLimit: DEFAULT_TIMELINE_LIMIT });
    if (!pagination.ok) return res.status(400).json(pagination.error);
    const entries = await storage.timeline.getTimeline(userId, { planId: req.query.planId, limit: pagination.value.limit, offset: pagination.value.offset });
    const hasMore = entries.length === pagination.value.limit;
    res.setHeader("X-Page-Info", JSON.stringify({ limit: pagination.value.limit, offset: pagination.value.offset, hasMore }));
    res.json(entries);
  }));
}
