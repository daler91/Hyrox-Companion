import { Router, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { getUserId, AuthenticatedRequest } from "../types";

const router = Router();

router.get('/api/auth/user', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    res.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

export default router;
