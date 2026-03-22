import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { rateLimiter, asyncHandler } from "../routeUtils";
import { storage } from "../storage";
import { updateUserPreferencesSchema, type UpdateUserPreferences } from "@shared/schema";
import { getUserId } from "../types";

const router = Router();

router.get('/api/v1/preferences', isAuthenticated, asyncHandler(async (req: ExpressRequest, res: Response) => {
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
  }));

router.patch('/api/v1/preferences', isAuthenticated, rateLimiter("preferences", 20), asyncHandler(async (req: ExpressRequest<Record<string, never>, any, UpdateUserPreferences>, res: Response) => {
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
  }));

export default router;
