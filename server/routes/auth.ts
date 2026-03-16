import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { getUserId, AuthenticatedRequest } from "../types";
import { handleRouteError } from "../routeUtils";

const router = Router();

router.get('/api/auth/user', isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    res.json(user);
  } catch (error) {
    handleRouteError(res, error, "Error fetching user:", "Failed to fetch user");
  }
});

export default router;
