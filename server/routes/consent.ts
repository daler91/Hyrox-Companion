import { type RecordConsentInput, recordConsentSchema } from "@shared/schema";
import { type Request as ExpressRequest, type Response, Router } from "express";

import { isAuthenticated } from "../clerkAuth";
import { asyncHandler, rateLimiter, validateBody } from "../routeUtils";
import { storage } from "../storage";
import { getUserId } from "../types";
import { protectedPost } from "./_helpers/protectedRouteBuilder";

const router = Router();

/**
 * POST /api/v1/consents — record an auditable consent decision (W4).
 * The privacy banner and Sentry opt-in still write localStorage for the
 * fast client-side gate, but authenticated users also get a server-side
 * record of {userId, consentType, granted, consentedAt} so consent is
 * demonstrable (GDPR Art. 7) and an opt-out is on file (CCPA).
 */
protectedPost(
  router,
  "/api/v1/consents",
  { limiter: rateLimiter("consent", 20), middleware: [validateBody(recordConsentSchema)] },
  async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const { consentType, granted } = req.body as RecordConsentInput;
    await storage.consent.recordConsent(userId, consentType, granted);
    res.json({ success: true });
  },
);

/** GET /api/v1/consents — the user's recorded consent decisions (DSAR support). */
router.get(
  "/api/v1/consents",
  isAuthenticated,
  rateLimiter("consent", 30),
  asyncHandler(async (req: ExpressRequest, res: Response) => {
    const consents = await storage.consent.getConsents(getUserId(req));
    res.json({ consents });
  }),
);

export default router;
