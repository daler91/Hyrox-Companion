import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { rateLimiter, asyncHandler } from "../routeUtils";
import { storage } from "../storage";
import { getUserId } from "../types";

const router = Router();

// 🛡️ Sentinel: Added rate limit to auth endpoint to prevent abuse
router.get(
  "/api/v1/auth/user",
  isAuthenticated,
  rateLimiter("auth", 20),
  asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    res.json(user);
  }),
);

export default router;
