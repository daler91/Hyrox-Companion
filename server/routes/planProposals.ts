import type { PlanAdjustmentProposal } from "@shared/schema";
import { type Request as ExpressRequest, type Response, Router } from "express";

import { isAuthenticated } from "../clerkAuth";
import { reqLogger } from "../logger";
import { aiConsentCheck } from "../middleware/aiConsent";
import { asyncHandler, rateLimiter, sendNotFound } from "../routeUtils";
import {
  applyPlanAdjustmentProposal,
  dismissPlanAdjustmentProposal,
} from "../services/planAdjustmentService";
import { storage } from "../storage";
import { getUserId } from "../types";
import { protectedPost } from "./_helpers/protectedRouteBuilder";

const router = Router();

/** Client-facing proposal shape — payload.changes flattened onto the object. */
export function serializePlanProposal(proposal: PlanAdjustmentProposal) {
  return {
    id: proposal.id,
    planId: proposal.planId,
    status: proposal.status,
    summaryMessage: proposal.summaryMessage,
    changes: proposal.payload.changes,
    createdAt: proposal.createdAt,
  };
}

router.get(
  "/api/v1/plan-proposals/pending",
  isAuthenticated,
  rateLimiter("analytics", 60),
  asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const proposal = await storage.planProposals.getPending(userId);
    res.json({ proposal: proposal ? serializePlanProposal(proposal) : null });
  }),
);

// aiBudgetCheck is deliberately absent here (same rationale as the
// suggestions apply route): the budget is checked internally only when a
// structured re-parse is actually needed.
protectedPost(
  router,
  "/api/v1/plan-proposals/:id/apply",
  { limiter: rateLimiter("suggestionApply", 10), middleware: [aiConsentCheck] },
  async (req: ExpressRequest<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    const result = await applyPlanAdjustmentProposal(userId, req.params.id, reqLogger(req));
    if (!result) {
      sendNotFound(res, "Proposal not found");
      return;
    }
    if (!result.applied && (result.reason === "not_pending" || result.reason === "stale")) {
      res.status(409).json(result);
      return;
    }
    res.json(result);
  },
);

protectedPost(
  router,
  "/api/v1/plan-proposals/:id/dismiss",
  { limiter: rateLimiter("suggestionApply", 10) },
  async (req: ExpressRequest<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    const result = await dismissPlanAdjustmentProposal(userId, req.params.id);
    if (!result) {
      sendNotFound(res, "Proposal not found");
      return;
    }
    res.json(result);
  },
);

export default router;
