import { logger } from "../logger";
import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { getUserId } from "../types";

const router = Router();

router.get('/api/v1/auth/user', isAuthenticated, async (req: ExpressRequest, res: Response) => {
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
