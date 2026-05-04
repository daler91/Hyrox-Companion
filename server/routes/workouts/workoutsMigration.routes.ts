import { type Request, type Response, type Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, validateBody } from "../../routeUtils";
import { listBackfillReviews, resolveBackfillReview, runAssistedMigrationBackfill } from "../../services/assistedMigrationService";
import { getUserId } from "../../types";
import { protectedPost } from "../_helpers/protectedRouteBuilder";

const resolveSchema = z.object({
  ownerType: z.enum(["workoutLog", "planDay"]),
  ownerId: z.string().min(1),
  action: z.enum(["accept", "reject", "edit"]),
  reason: z.string().max(500).optional().nullable(),
});

export function registerWorkoutMigrationRoutes(router: Router): void {
  protectedPost(router, "/api/v1/workouts/migration/backfill", { limiter: rateLimiter("migrationBackfill", 2) }, async (req: Request, res: Response) => {
    const result = await runAssistedMigrationBackfill(getUserId(req));
    res.json(result);
  });

  router.get("/api/v1/workouts/migration/reviews", isAuthenticated, rateLimiter("migrationReviews", 20), asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    res.json(await listBackfillReviews(userId));
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
