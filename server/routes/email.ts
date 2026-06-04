import crypto from "node:crypto";

import { type Request as ExpressRequest, type Response,Router } from "express";

import { checkAndSendEmailsForUser, runEmailCronJob } from "../emailScheduler";
import { env } from "../env";
import { asyncHandler, rateLimiter } from "../routeUtils";
import { storage } from "../storage";
import { getUserId } from "../types";
import { protectedPost } from "./_helpers/protectedRouteBuilder";

const router = Router();

protectedPost(router, "/api/v1/emails/check", { limiter: rateLimiter("emailCheck", 5) }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const user = await storage.users.getUser(userId);
    if (!user) {
      return res.json({ sent: [] });
    }
    const sent = await checkAndSendEmailsForUser(storage, user);
    res.json({ sent });
  });

// W3: rate-limit the secret-gated cron endpoint so a leaked CRON_SECRET can't
// be brute-forced or used to hammer the (expensive) all-users email job.
// Generous for a real scheduler (10/min, IP-keyed); GET fails open so a
// rate-limit-store blip can't block legitimate cron runs.
router.get("/api/v1/cron/emails", rateLimiter("cronEmails", 10, 60_000), asyncHandler(async (req: ExpressRequest, res: Response) => {
  const secret = req.headers["x-cron-secret"] as string;
  const cronSecret = env.CRON_SECRET;

  if (!cronSecret || !secret) {
    return res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
  }

  // Use timingSafeEqual with hashed values to prevent timing attacks
  // and safely handle different string lengths.
  const secretHash = crypto.createHash("sha256").update(secret).digest();
  const cronSecretHash = crypto.createHash("sha256").update(cronSecret).digest();

  if (!crypto.timingSafeEqual(secretHash, cronSecretHash)) {
    return res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
  }
    const result = await runEmailCronJob(storage);
    res.json(result);
  }));

export default router;
