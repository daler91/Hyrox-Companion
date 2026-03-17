import { logger } from "../logger";
import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { checkAndSendEmailsForUser, runEmailCronJob } from "../emailScheduler";
import { getUserId } from "../types";

const router = Router();

router.post("/api/emails/check", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    if (!user) {
      return res.json({ sent: [] });
    }
    const sent = await checkAndSendEmailsForUser(storage, user);
    res.json({ sent });
  } catch (error) {
    logger.error({ err: error }, "Error checking emails:");
    res.json({ sent: [], error: "Email check failed" });
  }
});

router.get("/api/cron/emails", async (req, res) => {
  const secret = req.headers["x-cron-secret"] as string;
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Use timingSafeEqual with hashed values to prevent timing attacks
  // and safely handle different string lengths.
  const secretHash = crypto.createHash("sha256").update(secret).digest();
  const cronSecretHash = crypto.createHash("sha256").update(cronSecret).digest();

  if (!crypto.timingSafeEqual(secretHash, cronSecretHash)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await runEmailCronJob(storage);
    res.json(result);
  } catch (error) {
    logger.error({ err: error }, "Cron email error:");
    res.status(500).json({ error: "Cron job failed" });
  }
});

export default router;
