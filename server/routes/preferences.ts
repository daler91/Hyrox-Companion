import { type UpdateUserPreferences,updateUserPreferencesSchema } from "@shared/schema";
import { type Request as ExpressRequest, type Response,Router } from "express";

import { isAuthenticated } from "../clerkAuth";
import { asyncHandler, rateLimiter, sendNotFound, validateBody } from "../routeUtils";
import { storage } from "../storage";
import { getUserId } from "../types";
import { protectedPatch } from "./_helpers/protectedRouteBuilder";

const router = Router();

function hasOwn<T extends object>(obj: T, key: keyof T): boolean {
  return Object.hasOwn(obj, key);
}

function validateMafTransition(payload: UpdateUserPreferences, current: Awaited<ReturnType<typeof storage.users.getUser>>) {
  if (!current) return null;
  const switchingToMaf = payload.trainingStyleId === "maf_method";
  if (!switchingToMaf) return null;

  const nextMafAge = hasOwn(payload, "mafAge") ? payload.mafAge ?? null : current.mafAge ?? null;
  const nextMafConsistency = hasOwn(payload, "mafConsistency") ? payload.mafConsistency ?? null : current.mafConsistency ?? null;
  const nextMafTrend = hasOwn(payload, "mafTrend") ? payload.mafTrend ?? null : current.mafTrend ?? null;

  const missing: string[] = [];
  if (nextMafAge == null) missing.push("mafAge");
  if (nextMafConsistency == null) missing.push("mafConsistency");
  if (nextMafTrend == null) missing.push("mafTrend");

  if (missing.length === 0) return null;
  return {
    error: "MAF setup is incomplete",
    code: "MAF_SETUP_REQUIRED",
    details: missing.map((field) => ({ field, message: `${field} is required when trainingStyleId is maf_method` })),
  };
}

function serializePreferences(user: {
  weightUnit: string | null;
  distanceUnit: string | null;
  weeklyGoal: number | null;
  emailNotifications: boolean | null;
  emailWeeklySummary: boolean | null;
  emailMissedReminder: boolean | null;
  showAdherenceInsights: boolean | null;
  aiCoachEnabled: boolean | null;
  trainingStyleId: string | null;
  trainingStylePreviousId: string | null;
  trainingStyleChangedAt: Date | null;
  trainingStyleRecomputeNow: boolean | null;
  mafAge: number | null;
  mafInjuryIllnessMedication: boolean | null;
  mafConsistency: string | null;
  mafTrend: string | null;
  mafHrDataAvailable: boolean | null;
  mafHr: number | null;
  mafBaselineTestScheduledAt: Date | null;
}) {
  return {
    weightUnit: user.weightUnit ?? "kg",
    distanceUnit: user.distanceUnit ?? "km",
    weeklyGoal: user.weeklyGoal ?? 5,
    emailNotifications: user.emailNotifications ?? false,
    emailWeeklySummary: user.emailWeeklySummary ?? false,
    emailMissedReminder: user.emailMissedReminder ?? false,
    showAdherenceInsights: user.showAdherenceInsights ?? true,
    aiCoachEnabled: user.aiCoachEnabled ?? false,
    trainingStyleId: user.trainingStyleId ?? "balanced_default",
    trainingStylePreviousId: user.trainingStylePreviousId ?? null,
    trainingStyleChangedAt: user.trainingStyleChangedAt ?? null,
    trainingStyleRecomputeNow: user.trainingStyleRecomputeNow ?? false,
    mafAge: user.mafAge ?? null,
    mafInjuryIllnessMedication: user.mafInjuryIllnessMedication ?? null,
    mafConsistency: user.mafConsistency ?? null,
    mafTrend: user.mafTrend ?? null,
    mafHrDataAvailable: user.mafHrDataAvailable ?? null,
    mafHr: user.mafHr ?? null,
    mafBaselineTestScheduledAt: user.mafBaselineTestScheduledAt ?? null,
  };
}

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
      ...serializePreferences(user),
      planWeeklyDensity: planWeeklyDensity ?? null,
      weeklyGoalExceedsPlan:
        planWeeklyDensity !== undefined && weeklyGoal > planWeeklyDensity,
    });
  }));

protectedPatch(router, '/api/v1/preferences', { limiter: rateLimiter("preferences", 20), middleware: [validateBody(updateUserPreferencesSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, UpdateUserPreferences>, res: Response) => {
    const userId = getUserId(req);

    const current = await storage.users.getUser(userId);
    const mafValidationError = validateMafTransition(req.body, current);
    if (mafValidationError) {
      return res.status(400).json(mafValidationError);
    }

    const user = await storage.users.updateUserPreferences(userId, req.body);
    if (!user) {
      return sendNotFound(res, "User not found");
    }
    res.json(serializePreferences(user));
  });

export default router;
