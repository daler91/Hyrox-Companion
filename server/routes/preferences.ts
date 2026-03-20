import { logger } from "../logger";
import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { rateLimiter } from "../routeUtils";
import { storage } from "../storage";
import { updateUserPreferencesSchema, type UpdateUserPreferences } from "@shared/schema";
import { getUserId } from "../types";

const router = Router();

router.get('/api/v1/preferences', isAuthenticated, async (req: ExpressRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({
      weightUnit: user.weightUnit || "kg",
      distanceUnit: user.distanceUnit || "km",
      weeklyGoal: user.weeklyGoal || 5,
      emailNotifications: user.emailNotifications ?? true,
      aiCoachEnabled: user.aiCoachEnabled ?? true,
    });
  } catch (error) {
    logger.error({ err: error }, "Error fetching preferences:");
    res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

router.patch('/api/v1/preferences', isAuthenticated, rateLimiter("preferences", 20), async (req: ExpressRequest<{}, any, UpdateUserPreferences>, res: Response) => {
  try {
    const userId = getUserId(req);
    const parseResult = updateUserPreferencesSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid preferences data", details: parseResult.error });
    }

    const user = await storage.updateUserPreferences(userId, parseResult.data);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({
      weightUnit: user.weightUnit,
      distanceUnit: user.distanceUnit,
      weeklyGoal: user.weeklyGoal,
      emailNotifications: user.emailNotifications ?? true,
      aiCoachEnabled: user.aiCoachEnabled ?? true,
    });
  } catch (error) {
    logger.error({ err: error }, "Error updating preferences:");
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

export default router;
