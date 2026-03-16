import { Router } from "express";
import crypto from "node:crypto";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { checkAndSendEmailsForUser, runEmailCronJob } from "../emailScheduler";
import { getUserId, AuthenticatedRequest } from "../types";
import { handleError } from "../routeUtils";

const router = Router();

router.post("/api/emails/check", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    if (!user) {
      return res.json({ sent: [] });
    }
    const sent = await checkAndSendEmailsForUser(storage, user);
    res.json({ sent });
  } catch (error) {
    console.error("Error checking emails:", error);
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
    handleError(res, error, "Cron email error:", "Cron job failed", 500);
  }
});

export default router;
