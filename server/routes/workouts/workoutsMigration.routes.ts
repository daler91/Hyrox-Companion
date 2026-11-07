import {
  type MigrationReviewResolveBody,
  migrationReviewResolveSchema,
  type MigrationReviewsQuery,
  migrationReviewsQuerySchema,
} from "@shared/schema/types/workoutsRequests";
import { type Request, type Response, type Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, validateBody, validateQuery } from "../../routeUtils";
import { invalidateAnalyticsCachesForUser } from "../../services/analyticsRouteCache";
import { listBackfillReviews, resolveBackfillReview, runAssistedMigrationBackfill } from "../../services/assistedMigrationService";
import { getUserId } from "../../types";
import { protectedPost } from "../_helpers/protectedRouteBuilder";

export function registerWorkoutMigrationRoutes(router: Router): void {
  // Each call sends up to 50 workout and plan-day texts to the AI parser, so it
  // takes the same consent and budget gates as batch-reparse — P6
  // (CODEBASE_ANALYSIS_2026-10-03).
  protectedPost(router, "/api/v1/workouts/migration/backfill", { limiter: rateLimiter("migrationBackfill", 2), aiConsent: true, aiBudget: true }, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const result = await runAssistedMigrationBackfill(userId);
    // D10 (CODEBASE_ANALYSIS_2026-10-03): the backfill writes sets onto the
    // athlete's workouts, so their cached analytics slices are stale.
    invalidateAnalyticsCachesForUser(userId);
    res.json(result);
  });

  router.get("/api/v1/workouts/migration/reviews", isAuthenticated, rateLimiter("migrationReviews", 20), validateQuery(migrationReviewsQuerySchema), asyncHandler(async (req: Request<Record<string, never>, unknown, unknown, MigrationReviewsQuery>, res: Response) => {
    const userId = getUserId(req);
    res.json(await listBackfillReviews(userId, req.query));
  }));

  protectedPost(router, "/api/v1/workouts/migration/reviews/resolve", { limiter: rateLimiter("migrationReviewResolve", 20), middleware: [validateBody(migrationReviewResolveSchema)] }, async (req: Request<Record<string, never>, unknown, MigrationReviewResolveBody>, res: Response) => {
    const userId = getUserId(req);
    const status = req.body.action === "reject" ? "needs_manual_review" : "resolved";
    const updated = await resolveBackfillReview(req.body.ownerType, req.body.ownerId, userId, status, req.body.reason ?? null);
    if (!updated) {
      return res.status(404).json({ error: "Migration review target not found", code: "NOT_FOUND" });
    }
    res.json({ ok: true });
  });
}
