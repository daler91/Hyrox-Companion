import { type Request as ExpressRequest, type Response,Router } from "express";

import { isAuthenticated } from "../clerkAuth";
import { asyncHandler,rateLimiter } from "../routeUtils";
import { storage } from "../storage";
import { getUserId } from "../types";

const router = Router();

// While the auto-coach runs, the client polls this route every 2 s (30/min,
// useAuth's COACHING_POLL_INTERVAL_MS) to learn when it finishes. At 20/min
// the poll got 429s after ~40 s, so the client could not see the job finish
// until the window reset. 60/min covers the poll plus ordinary refetches, and
// the bucket key includes the cap, so this limiter keeps its own counter.
// C5 (CODEBASE_ANALYSIS_2026-10-03)
const AUTH_USER_RATE_LIMIT_PER_MIN = 60;

// 🛡️ Sentinel: Added rate limit to auth endpoint to prevent abuse
router.get('/api/v1/auth/user', isAuthenticated, rateLimiter("auth", AUTH_USER_RATE_LIMIT_PER_MIN), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const user = await storage.users.getUser(userId);
    res.json(user);
  }));

export default router;
