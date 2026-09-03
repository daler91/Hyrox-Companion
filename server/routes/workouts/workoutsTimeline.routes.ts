import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { DEFAULT_TIMELINE_LIMIT, DEFAULT_TIMELINE_PAGE_SIZE } from "../../constants";
import { asyncHandler, parsePagination, rateLimiter } from "../../routeUtils";
import { storage } from "../../storage";
import { getUserId } from "../../types";

type TimelineQuery = { planId?: string; limit?: string; offset?: string; before?: string };
type TimelineRequest = Request<Record<string, never>, Record<string, never>, Record<string, never>, TimelineQuery>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Cursor-paged timeline (P3). The body stays a plain `TimelineEntry[]`; when
 * older entries exist the exclusive date bound for the next page is surfaced
 * in the `X-Next-Cursor` header (same shape as `/chat/history`), and the
 * client echoes it back as `?before=`. The first page (no `before`) is
 * anchored on the athlete's today, see `TimelineStorage.getTimelinePage`.
 * `offset` is the pre-cursor contract and still windows the flat merge with
 * no cursor header, so nothing that sends it breaks.
 */
export function registerWorkoutTimelineRoutes(router: Router): void {
  router.get("/api/v1/timeline", isAuthenticated, rateLimiter("timeline", 60), asyncHandler(async (req: TimelineRequest, res: Response) => {
    const userId = getUserId(req);
    const { planId, before } = req.query;
    const pagination = parsePagination(req.query, res, { defaultLimit: DEFAULT_TIMELINE_PAGE_SIZE });
    if (!pagination) return;
    const limit = Math.min(pagination.limit, DEFAULT_TIMELINE_LIMIT);

    if (pagination.offset !== undefined) {
      res.json(await storage.timeline.getTimeline(userId, planId, limit, pagination.offset));
      return;
    }
    if (before !== undefined && !ISO_DATE.test(before)) {
      res.status(400).json({ error: "Invalid before", code: "BAD_REQUEST" });
      return;
    }

    const page = await storage.timeline.getTimelinePage(userId, { planId, limit, before });
    if (page.nextCursor) res.setHeader("X-Next-Cursor", page.nextCursor);
    res.json(page.entries);
  }));
}
