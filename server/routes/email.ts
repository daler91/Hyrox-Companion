import { Router } from "express";
import { isAuthenticated } from "../replitAuth";
import { storage } from "../storage";
import { checkAndSendEmailsForUser, runEmailCronJob } from "../emailScheduler";

const router = Router();

router.post("/api/emails/check", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
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
  const secret = (req.headers["x-cron-secret"] as string) || (req.query.secret as string);
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || secret !== cronSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const result = await runEmailCronJob(storage);
    res.json(result);
  } catch (error) {
    console.error("Cron email error:", error);
    res.status(500).json({ error: "Cron job failed" });
  }
});

export default router;
