import {
  type ApplyPlanProposalRequest,
  applyPlanProposalRequestSchema,
  type PlanAdjustmentProposal,
} from "@shared/schema";
import { type Request as ExpressRequest, type Response, Router } from "express";

import { isAuthenticated } from "../clerkAuth";
import { reqLogger } from "../logger";
import { aiConsentCheck } from "../middleware/aiConsent";
import { asyncHandler, rateLimiter, sendNotFound, validateBody } from "../routeUtils";
import {
  applyPlanAdjustmentProposal,
  dismissPlanAdjustmentProposal,
  undoPlanAdjustmentProposal,
} from "../services/planAdjustmentService";
import { appliedPlanDayIds, isUndoable } from "../services/planProposalUndo";
import { storage } from "../storage";
import { getUserId } from "../types";
import { protectedPost } from "./_helpers/protectedRouteBuilder";

const router = Router();

/**
 * Client-facing proposal shape — payload.changes flattened onto the object.
 * An applied or undone proposal also says which days it changed (the athlete
 * may have picked some), and an applied one whether it can still be undone.
 */
export function serializePlanProposal(proposal: PlanAdjustmentProposal) {
  const decided = proposal.status === "applied" || proposal.status === "reverted";
  return {
    id: proposal.id,
    planId: proposal.planId,
    status: proposal.status,
    summaryMessage: proposal.summaryMessage,
    changes: proposal.payload.changes,
    createdAt: proposal.createdAt,
    ...(decided ? { appliedPlanDayIds: appliedPlanDayIds(proposal) } : {}),
    ...(proposal.status === "applied" ? { undoable: isUndoable(proposal) } : {}),
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

// One proposal and its current status, for a card shown at the chat turn
// that produced it (it may have been applied or replaced since).
router.get(
  "/api/v1/plan-proposals/:id",
  isAuthenticated,
  rateLimiter("analytics", 60),
  asyncHandler(async (req: ExpressRequest<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    const proposal = await storage.planProposals.getById(req.params.id, userId);
    if (!proposal) {
      sendNotFound(res, "Proposal not found");
      return;
    }
    res.json({ proposal: serializePlanProposal(proposal) });
  }),
);

// aiBudgetCheck is deliberately absent here (same rationale as the
// suggestions apply route): the budget is checked internally only when a
// structured re-parse is actually needed.
protectedPost(
  router,
  "/api/v1/plan-proposals/:id/apply",
  {
    limiter: rateLimiter("suggestionApply", 10),
    middleware: [aiConsentCheck, validateBody(applyPlanProposalRequestSchema)],
  },
  async (req: ExpressRequest<{ id: string }, unknown, ApplyPlanProposalRequest>, res: Response) => {
    const userId = getUserId(req);
    const result = await applyPlanAdjustmentProposal(userId, req.params.id, {
      planDayIds: req.body.planDayIds,
      log: reqLogger(req),
    });
    if (!result) {
      sendNotFound(res, "Proposal not found");
      return;
    }
    if (!result.applied && result.reason === "invalid_selection") {
      res.status(400).json(result);
      return;
    }
    if (!result.applied && (result.reason === "not_pending" || result.reason === "stale")) {
      res.status(409).json(result);
      return;
    }
    res.json(result);
  },
);

// Undo writes no AI output and makes no AI call, so it needs neither the AI
// consent nor the budget check.
protectedPost(
  router,
  "/api/v1/plan-proposals/:id/undo",
  { limiter: rateLimiter("suggestionApply", 10) },
  async (req: ExpressRequest<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    const result = await undoPlanAdjustmentProposal(userId, req.params.id, reqLogger(req));
    if (!result) {
      sendNotFound(res, "Proposal not found");
      return;
    }
    res.status(result.undone ? 200 : 409).json(result);
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
