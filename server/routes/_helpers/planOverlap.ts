import type { TrainingPlan } from "@shared/schema";
import type { Response } from "express";

import { ErrorCode } from "../../errors";

/**
 * The 409 for putting two live plans over the same days. Shared by
 * un-retiring a plan (PATCH /plans/:id/retirement) and restoring one from
 * the recycle bin — both re-expose a plan to every "which plan is active"
 * query, so both must refuse the same way, with the same copy.
 */
export function sendPlanOverlap(res: Response, overlapping: Pick<TrainingPlan, "name">): Response {
  return res.status(409).json({
    error: `"${overlapping.name}" already covers these dates. Archive it first to restore this plan.`,
    code: ErrorCode.PLAN_OVERLAP,
  });
}
