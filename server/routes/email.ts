import { asyncHandler } from "../routeUtils";
import { env } from "../env";
import { Router, type Request as ExpressRequest, type Response } from "express";
import crypto from "node:crypto";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { checkAndSendEmailsForUser, runEmailCronJob } from "../emailScheduler";
import { getUserId } from "../types";

const router = Router();

router.post("/api/v1/emails/check", isAuthenticated, asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    if (!user) {
      return res.json({ sent: [] });
    }
    const sent = await checkAndSendEmailsForUser(storage, user);
    res.json({ sent });
  }));

router.get("/api/v1/cron/emails", asyncHandler(async (req: ExpressRequest, res: Response) => {
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
