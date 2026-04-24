import { type UpdateUserPreferences,updateUserPreferencesSchema } from "@shared/schema";
import { type Request as ExpressRequest, type Response,Router } from "express";

import { isAuthenticated } from "../clerkAuth";
import { protectedMutationGuards } from "../routeGuards";
import { asyncHandler, formatValidationErrors,rateLimiter, sendNotFound } from "../routeUtils";
import { storage } from "../storage";
import { getUserId } from "../types";

const router = Router();

router.get('/api/v1/preferences', isAuthenticated, asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const user = await storage.users.getUser(userId);
    if (!user) {
      return sendNotFound(res, "User not found");
    }

    // S4 — if the user's weeklyGoal exceeds their active plan's density,
    // surface a non-blocking hint so the UI can warn them that they'll
    // need to log ad-hoc workouts on top of the plan to hit the goal.
    // Non-blocking by design: some users legitimately log extra cardio.
    //
    // storage.plans.getActivePlan falls back to recently-ended / next-upcoming
    // plans, so we gate the hint on the returned plan actually covering today
    // — users between plans should see the "no active plan" shape (null/false).
    const weeklyGoal = user.weeklyGoal ?? 5;
    const activePlan = await storage.plans.getActivePlan(userId);
    const today = new Date().toISOString().split("T")[0];
    const planCoversToday =
      activePlan?.startDate != null &&
      activePlan.endDate != null &&
      activePlan.startDate <= today &&
      activePlan.endDate >= today;
    const planWeeklyDensity = planCoversToday
      ? await storage.plans.getPlanWeeklyDensity(activePlan.id)
      : undefined;

    res.json({
      weightUnit: user.weightUnit ?? "kg",
      distanceUnit: user.distanceUnit ?? "km",
      weeklyGoal,
      planWeeklyDensity: planWeeklyDensity ?? null,
      weeklyGoalExceedsPlan:
        planWeeklyDensity !== undefined && weeklyGoal > planWeeklyDensity,
      emailNotifications: user.emailNotifications ?? true,
      emailWeeklySummary: user.emailWeeklySummary ?? true,
      emailMissedReminder: user.emailMissedReminder ?? true,
      aiCoachEnabled: user.aiCoachEnabled ?? true,
    });
  }));

router.patch('/api/v1/preferences', ...protectedMutationGuards, rateLimiter("preferences", 20), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, UpdateUserPreferences>, res: Response) => {
    const userId = getUserId(req);
    const parseResult = updateUserPreferencesSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid preferences data", code: "VALIDATION_ERROR", details: formatValidationErrors(parseResult.error) });
    }

    const user = await storage.users.updateUserPreferences(userId, parseResult.data);
    if (!user) {
      return sendNotFound(res, "User not found");
    }
    res.json({
      weightUnit: user.weightUnit,
      distanceUnit: user.distanceUnit,
      weeklyGoal: user.weeklyGoal,
      emailNotifications: user.emailNotifications ?? true,
      emailWeeklySummary: user.emailWeeklySummary ?? true,
      emailMissedReminder: user.emailMissedReminder ?? true,
      aiCoachEnabled: user.aiCoachEnabled ?? true,
    });
  }));

export default router;
