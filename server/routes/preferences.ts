import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { updateUserPreferencesSchema } from "@shared/schema";
import { getUserId } from "../types";
import { AuthenticatedRequest } from "../types";


const router = Router();

router.get('/api/preferences', isAuthenticated, async (req: AuthenticatedRequest, res) => {
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
      emailNotifications: user.emailNotifications ?? 1,
    });
  } catch (error) {
    console.error("Error fetching preferences:", error);
    res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

router.patch('/api/preferences', isAuthenticated, async (req: AuthenticatedRequest, res) => {
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
      emailNotifications: user.emailNotifications ?? 1,
    });
  } catch (error) {
    console.error("Error updating preferences:", error);
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

export default router;
