import { z } from "zod";
import type { Router } from "express";

import { protectedGet, protectedPost } from "../../routeUtils";
import { requireUserId } from "../../utils/auth";
import { validateBody } from "../../middleware/validation";
import { listBackfillReviews, resolveBackfillReview, runAssistedMigrationBackfill } from "../../services/assistedMigrationService";

const resolveSchema = z.object({
  ownerType: z.enum(["workoutLog", "planDay"]),
  ownerId: z.string().min(1),
  action: z.enum(["accept", "reject", "edit"]),
  reason: z.string().max(500).optional().nullable(),
});

export function registerWorkoutMigrationRoutes(router: Router) {
  protectedPost(router, "/api/v1/workouts/migration/backfill", {}, async (req, res) => {
    requireUserId(req);
    const result = await runAssistedMigrationBackfill();
    res.json(result);
  });

  protectedGet(router, "/api/v1/workouts/migration/reviews", {}, async (req, res) => {
    const userId = requireUserId(req);
    res.json(await listBackfillReviews(userId));
  });

  protectedPost(router, "/api/v1/workouts/migration/reviews/resolve", { middleware: [validateBody(resolveSchema)] }, async (req, res) => {
    const userId = requireUserId(req);
    const status = req.body.action === "reject" ? "needs_manual_review" : "resolved";
    await resolveBackfillReview(req.body.ownerType, req.body.ownerId, userId, status, req.body.reason ?? null);
    res.json({ ok: true });
  });
}
