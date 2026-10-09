import { type Request, type Response, type Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, validateBody, validateQuery } from "../../routeUtils";
import { invalidateAnalyticsCachesForUser } from "../../services/analyticsRouteCache";
import { listBackfillReviews, resolveBackfillReview, runAssistedMigrationBackfill } from "../../services/assistedMigrationService";
import { getUserId } from "../../types";
import { protectedPost } from "../_helpers/protectedRouteBuilder";


const reviewsQuerySchema = z.object({
  ownerType: z.enum(["workoutLog", "planDay"]).optional(),
  ownerId: z.string().min(1).optional(),
}).refine((v) => (v.ownerType && v.ownerId) || (!v.ownerType && !v.ownerId), {
  message: "ownerType and ownerId must be provided together",
});

const resolveSchema = z.object({
  ownerType: z.enum(["workoutLog", "planDay"]),
  ownerId: z.string().min(1),
  action: z.enum(["accept", "reject", "edit"]),
  reason: z.string().max(500).optional().nullable(),
});

export function registerWorkoutMigrationRoutes(router: Router): void {
  // No client code calls this, so review rows exist only for an athlete it was
  // run for, and the review callout only ever shows to them. Left unexposed on
  // purpose (U25, CODEBASE_ANALYSIS_2026-10-03; decided 2026-10-09): production
  // had no review rows, its text-only logs were one athlete's imports, and a
  // button would spend AI budget re-parsing them for little gain.
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

  router.get("/api/v1/workouts/migration/reviews", isAuthenticated, rateLimiter("migrationReviews", 20), validateQuery(reviewsQuerySchema), asyncHandler(async (req: Request<Record<string, never>, unknown, unknown, z.infer<typeof reviewsQuerySchema>>, res: Response) => {
    const userId = getUserId(req);
    res.json(await listBackfillReviews(userId, req.query));
  }));

  protectedPost(router, "/api/v1/workouts/migration/reviews/resolve", { limiter: rateLimiter("migrationReviewResolve", 20), middleware: [validateBody(resolveSchema)] }, async (req: Request<Record<string, never>, unknown, z.infer<typeof resolveSchema>>, res: Response) => {
    const userId = getUserId(req);
    const status = req.body.action === "reject" ? "needs_manual_review" : "resolved";
    const updated = await resolveBackfillReview(req.body.ownerType, req.body.ownerId, userId, status, req.body.reason ?? null);
    if (!updated) {
      return res.status(404).json({ error: "Migration review target not found", code: "NOT_FOUND" });
    }
    res.json({ ok: true });
  });
}
