import {
  recycleBinBatchIdParamsSchema,
  type RecycleBinBatchRestoreResult,
  recycleBinItemIdParamsSchema,
  type RecycleBinRestoreResult,
} from "@shared/schema";
import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../clerkAuth";
import { ErrorCode } from "../errors";
import { asyncHandler, rateLimiter, sendNotFound, validateParams } from "../routeUtils";
import { storage } from "../storage";
import { getUserId } from "../types";
import { sendPlanOverlap } from "./_helpers/planOverlap";
import { protectedDelete, protectedPost } from "./_helpers/protectedRouteBuilder";

/**
 * Recycle bin: the snapshots that DELETE /workouts/:id, /plans/:id,
 * /plans/days/:dayId and POST /workouts/bulk-delete write before they
 * delete. Everything here is scoped to the authenticated user at the storage
 * layer — another user's id, an expired item and an unknown id all read as
 * "not found" so existence never leaks.
 */

const router = Router();

const ITEM_NOT_FOUND = "Recycle bin item not found";
const MUTATION_LIMITER = () => rateLimiter("recycleBinMutation", 20);

function sendRestoreOutcome(
  res: Response,
  result: RecycleBinRestoreResult | RecycleBinBatchRestoreResult,
): Response {
  if (result.ok) return res.json(result);
  switch (result.reason) {
    case "not_found":
      return sendNotFound(res, result.message);
    case "plan_overlap":
      return res.status(409).json({ error: result.message, code: ErrorCode.PLAN_OVERLAP });
    case "id_conflict":
    case "device_activity_reimported":
      return res.status(409).json({ error: result.message, code: ErrorCode.RECYCLE_BIN_CONFLICT });
  }
}

/** GET /api/v1/recycle-bin — the user's restorable items, newest first, no payloads. */
router.get(
  "/api/v1/recycle-bin",
  isAuthenticated,
  rateLimiter("recycleBin", 60),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await storage.recycleBin.list(getUserId(req)));
  }),
);

/**
 * POST /api/v1/recycle-bin/:id/restore
 *
 * Restoring a live training plan is the one case with a precondition the
 * storage layer cannot judge on its own: like un-retiring, it re-exposes the
 * plan to every "active plan" query, so it must not land on dates another
 * live plan already covers. Checked here, before the restore transaction,
 * with the same rule and copy as PATCH /plans/:id/retirement.
 */
protectedPost(
  router,
  "/api/v1/recycle-bin/:id/restore",
  { limiter: MUTATION_LIMITER(), middleware: [validateParams(recycleBinItemIdParamsSchema)] },
  async (req: Request<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    const item = await storage.recycleBin.get(userId, req.params.id);
    if (!item) return sendNotFound(res, ITEM_NOT_FOUND);

    if (item.payload.kind === "training_plan") {
      const { plan } = item.payload;
      if (plan.retiredOn === null && plan.startDate && plan.endDate) {
        const overlapping = await storage.plans.findOverlappingActivePlans(
          userId,
          plan.startDate,
          plan.endDate,
        );
        if (overlapping.length > 0) return sendPlanOverlap(res, overlapping[0]);
      }
    }

    return sendRestoreOutcome(res, await storage.recycleBin.restore(userId, item.id));
  },
);

/** POST /api/v1/recycle-bin/batches/:batchId/restore — undo a whole bulk delete, all or nothing. */
protectedPost(
  router,
  "/api/v1/recycle-bin/batches/:batchId/restore",
  { limiter: MUTATION_LIMITER(), middleware: [validateParams(recycleBinBatchIdParamsSchema)] },
  async (req: Request<{ batchId: string }>, res: Response) => {
    return sendRestoreOutcome(
      res,
      await storage.recycleBin.restoreBatch(getUserId(req), req.params.batchId),
    );
  },
);

/** DELETE /api/v1/recycle-bin/:id — "Delete forever". */
protectedDelete(
  router,
  "/api/v1/recycle-bin/:id",
  { limiter: MUTATION_LIMITER(), middleware: [validateParams(recycleBinItemIdParamsSchema)] },
  async (req: Request<{ id: string }>, res: Response) => {
    const purged = await storage.recycleBin.purgeItem(getUserId(req), req.params.id);
    if (!purged) return sendNotFound(res, ITEM_NOT_FOUND);
    res.json({ success: true });
  },
);

/** DELETE /api/v1/recycle-bin — "Empty bin". */
protectedDelete(
  router,
  "/api/v1/recycle-bin",
  { limiter: rateLimiter("recycleBinEmpty", 5) },
  async (req: Request, res: Response) => {
    const purgedCount = await storage.recycleBin.emptyBin(getUserId(req));
    res.json({ success: true, purgedCount });
  },
);

export default router;
