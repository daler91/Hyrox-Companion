import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";

import { withAuth } from "../routeUtils";

const router = Router();

router.get('/api/auth/user', isAuthenticated, withAuth(async (req, res, userId) => {
    const user = await storage.getUser(userId);
    res.json(user);
  }, "Error fetching user:", "Failed to fetch user"));

export default router;
