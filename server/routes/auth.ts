import { logger } from "../logger";
import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { rateLimiter } from "../routeUtils";
import { storage } from "../storage";
import { getUserId } from "../types";

const router = Router();

// 🛡️ Sentinel: Added rate limit to auth endpoint to prevent abuse
router.get('/api/v1/auth/user', isAuthenticated, rateLimiter("auth", 20), async (req: ExpressRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    res.json(user);
  } catch (error) {
    (req.log || logger).error({ err: error }, "Error fetching user:");
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

export default router;
