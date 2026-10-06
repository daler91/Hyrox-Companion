import type { PersonalRecordAchievement } from "@shared/schema";

import type { useToast } from "@/hooks/use-toast";
import { QUERY_KEYS, type UserPreferences } from "@/lib/api";
import { getExerciseLabel } from "@/lib/exerciseUtils";
import {
  formatPersonalRecordValue,
  formatRecordAmount,
  formatRecordTime,
  type PersonalRecordUnits,
} from "@/lib/personalRecordFormat";
import { queryClient } from "@/lib/queryClient";

type ToastFn = ReturnType<typeof useToast>["toast"];

/**
 * The athlete's units from the preferences query the logging surfaces have
 * already loaded (useUnitPreferences), or undefined before it has.
 */
function cachedRecordUnits(): PersonalRecordUnits | undefined {
  const preferences = queryClient.getQueryData<Partial<UserPreferences>>(QUERY_KEYS.preferences);
  if (typeof preferences?.weightUnit !== "string") return undefined;
  return {
    weightLabel: preferences.weightUnit === "lbs" ? "lbs" : "kg",
    distanceUnit: preferences.distanceUnit === "miles" ? "miles" : "km",
  };
}

/**
 * "Best time 3:52", "Max weight 105 kg": the weekly review's formatting, not
 * the raw decimal minutes and unitless numbers the toast used to print. With
 * the units not loaded, a weight or distance goes without one rather than with
 * a guessed one (docs/adr-units.md, rule 4). CL58 (CODEBASE_ANALYSIS_2026-10-03)
 */
function formatAchievementValue(
  achievement: PersonalRecordAchievement,
  units: PersonalRecordUnits | undefined,
): string {
  if (units) return formatPersonalRecordValue(achievement.metric, achievement.value, units);
  return achievement.metric === "bestTime"
    ? formatRecordTime(achievement.value)
    : formatRecordAmount(achievement.value);
}

function describeAchievement(
  achievement: PersonalRecordAchievement,
  units: PersonalRecordUnits | undefined,
): string {
  const exercise = getExerciseLabel(achievement.exerciseName, achievement.customLabel);
  return `${exercise}: ${achievement.metricLabel} ${formatAchievementValue(achievement, units)}`;
}

/**
 * One toast for the whole batch. The toaster keeps a single toast on screen
 * (TOAST_LIMIT), so one-per-record left only the last PR visible and a
 * two-PR session read as one.
 */
export function toastPersonalRecordAchievements(
  toast: ToastFn,
  achievements: readonly PersonalRecordAchievement[] | null | undefined,
  units?: PersonalRecordUnits,
): void {
  if (!achievements || achievements.length === 0) return;

  const recordUnits = units ?? cachedRecordUnits();
  toast({
    title: achievements.length === 1 ? "New PR" : `${achievements.length} new PRs`,
    description: achievements
      .map((achievement) => describeAchievement(achievement, recordUnits))
      .join(" · "),
  });
}
