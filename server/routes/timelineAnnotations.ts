import {
  insertTimelineAnnotationSchema,
  updateTimelineAnnotationSchema,
} from "@shared/schema";
import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../clerkAuth";
import { protectedMutationGuards } from "../routeGuards";
import { asyncHandler, formatValidationErrors, rateLimiter } from "../routeUtils";
import { storage } from "../storage";
import { getUserId } from "../types";

const router = Router();

/**
 * GET /api/v1/timeline-annotations
 * Returns all annotations for the authenticated user, ordered by startDate ASC.
 */
router.get(
  "/api/v1/timeline-annotations",
  isAuthenticated,
  rateLimiter("annotations", 60),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const annotations = await storage.timelineAnnotations.list(userId);
    res.json(annotations);
  }),
);

/**
 * POST /api/v1/timeline-annotations
 * Create a new injury/illness/travel/rest annotation spanning [startDate, endDate].
 */
router.post(
  "/api/v1/timeline-annotations",
  ...protectedMutationGuards,
  rateLimiter("annotations", 20),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const parseResult = insertTimelineAnnotationSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Invalid annotation",
        code: "VALIDATION_ERROR",
        details: formatValidationErrors(parseResult.error),
      });
    }
    const row = await storage.timelineAnnotations.create(userId, parseResult.data);
    res.status(201).json(row);
  }),
);

/**
 * PATCH /api/v1/timeline-annotations/:id
 * Partial update. The per-user ownership check is enforced at the storage
 * level so a mismatched id silently returns 404 (can't leak existence).
 */
router.patch(
  "/api/v1/timeline-annotations/:id",
  ...protectedMutationGuards,
  rateLimiter("annotations", 20),
  asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    const parseResult = updateTimelineAnnotationSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Invalid annotation update",
        code: "VALIDATION_ERROR",
        details: formatValidationErrors(parseResult.error),
      });
    }
    const row = await storage.timelineAnnotations.update(userId, req.params.id, parseResult.data);
    if (!row) {
      return res.status(404).json({ error: "Annotation not found", code: "NOT_FOUND" });
    }
    res.json(row);
  }),
);

/**
 * DELETE /api/v1/timeline-annotations/:id
 */
router.delete(
  "/api/v1/timeline-annotations/:id",
  ...protectedMutationGuards,
  rateLimiter("annotations", 20),
  asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    const deleted = await storage.timelineAnnotations.delete(userId, req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Annotation not found", code: "NOT_FOUND" });
    }
    res.json({ success: true });
  }),
);

export default router;
