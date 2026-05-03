import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { DEFAULT_TIMELINE_LIMIT } from "../../constants";
import { asyncHandler, parsePagination, rateLimiter, setOffsetPaginationHeaders } from "../../routeUtils";
import { storage } from "../../storage";
import { getUserId } from "../../types";

export function registerWorkoutTimelineRoutes(router: Router): void {
  router.get("/api/v1/timeline", isAuthenticated, rateLimiter("timeline", 60), asyncHandler(async (req: Request<Record<string, never>, Record<string, never>, Record<string, never>, { planId?: string; limit?: string; offset?: string }>, res: Response) => {
    const userId = getUserId(req);
    const pagination = parsePagination(req.query, res, { defaultLimit: DEFAULT_TIMELINE_LIMIT });
    if (!pagination) return;
    const limit = Math.min(pagination.limit, DEFAULT_TIMELINE_LIMIT);
    const entries = await storage.timeline.getTimeline(userId, req.query.planId, limit + 1, pagination.offset);
    const hasMore = entries.length > limit;
    setOffsetPaginationHeaders(res, { ...pagination, limit }, hasMore);
    res.json(hasMore ? entries.slice(0, limit) : entries);
  }));
}
