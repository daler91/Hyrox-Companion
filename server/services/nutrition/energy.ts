import { computeEnergyBalance, type EnergyBalanceSummary } from "@shared/energyBalance";
import type { ActivityLevel } from "@shared/nutritionTargets";

import { storage } from "../../storage";

const ACTIVITY_LEVELS: readonly ActivityLevel[] = [
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
];

function toActivityLevel(value: string | null | undefined): ActivityLevel | null {
  return ACTIVITY_LEVELS.includes(value as ActivityLevel) ? (value as ActivityLevel) : null;
}

/**
 * Phase 4 — resolve the day's energy balance for the daily summary: the user's
 * BMR profile + the day's logged workouts. Workout `calories` come from
 * Strava/Garmin sync (or manual entry); when at least one workout carries them
 * the balance uses the measured path, otherwise the static TDEE estimate.
 * Returns null (summary omits the block) when the profile can't support a BMR.
 */
export async function resolveDayEnergy(
  userId: string,
  date: string,
  intakeKcal: number,
): Promise<EnergyBalanceSummary | null> {
  const user = await storage.users.getUser(userId);
  // No BMR inputs → no balance; skip the workout read so summaries stay as
  // cheap as before for profiles that can't show one.
  if (!user?.bodyweightKg || !user.heightCm || !user.age) return null;

  const workouts = await storage.analytics.getWorkoutLogsByDateRange(userId, date, date);
  const measured = workouts.reduce(
    (acc, w) => acc + (w.calories != null && w.calories > 0 ? w.calories : 0),
    0,
  );

  return computeEnergyBalance({
    intakeKcal,
    measuredActiveKcal: measured > 0 ? measured : null,
    bodyweightKg: user.bodyweightKg ?? null,
    heightCm: user.heightCm ?? null,
    ageYears: user.age ?? null,
    // Same mapping as the targets calculator: "prefer_not_to_say"/null → neutral BMR.
    sex: user.gender === "male" ? "male" : user.gender === "female" ? "female" : null,
    activityLevel: toActivityLevel(user.activityLevel),
  });
}
