import { type ApplyMissedRecoveryBody, applyMissedRecoverySchema } from "@shared/schema";
import { type Request as ExpressRequest, type Response, Router } from "express";

import { isAuthenticated } from "../clerkAuth";
import { asyncHandler, rateLimiter, validateBody } from "../routeUtils";
import { applyMissedSessionRecovery, getMissedSessionRecoveryPreview } from "../services/missedRecovery";
import { getUserId } from "../types";
import { protectedPost } from "./_helpers/protectedRouteBuilder";

/**
 * Missed-session recovery (services/missedRecovery): what folding a missed
 * session into another day, shortening it, or letting it go would do to the
 * plan, and carrying out the athlete's choice.
 */
const router = Router();

const RECOVERY_PATH = "/api/v1/plans/days/:dayId/recovery";

router.get(
  RECOVERY_PATH,
  isAuthenticated,
  rateLimiter("planDayRecoveryRead", 60),
  asyncHandler(async (req: ExpressRequest<{ dayId: string }>, res: Response) => {
    res.json(await getMissedSessionRecoveryPreview(getUserId(req), req.params.dayId));
  }),
);

protectedPost(
  router,
  RECOVERY_PATH,
  { limiter: rateLimiter("planDayRecovery", 20), middleware: [validateBody(applyMissedRecoverySchema)] },
  async (req: ExpressRequest<{ dayId: string }, unknown, ApplyMissedRecoveryBody>, res: Response) => {
    const day = await applyMissedSessionRecovery(getUserId(req), req.params.dayId, req.body);
    res.json({ day });
  },
);

export default router;
