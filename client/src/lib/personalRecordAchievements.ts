import type { PersonalRecordAchievement } from "@shared/schema";

import type { useToast } from "@/hooks/use-toast";
import { getExerciseLabel } from "@/lib/exerciseUtils";

type ToastFn = ReturnType<typeof useToast>["toast"];

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatAchievementValue(achievement: PersonalRecordAchievement): string {
  return `${achievement.metricLabel} ${formatNumber(achievement.value)}`;
}

function describeAchievement(achievement: PersonalRecordAchievement): string {
  const exercise = getExerciseLabel(achievement.exerciseName, achievement.customLabel);
  return `${exercise}: ${formatAchievementValue(achievement)}`;
}

/**
 * One toast for the whole batch. The toaster keeps a single toast on screen
 * (TOAST_LIMIT), so one-per-record left only the last PR visible and a
 * two-PR session read as one.
 */
export function toastPersonalRecordAchievements(
  toast: ToastFn,
  achievements: readonly PersonalRecordAchievement[] | null | undefined,
): void {
  if (!achievements || achievements.length === 0) return;

  toast({
    title: achievements.length === 1 ? "New PR" : `${achievements.length} new PRs`,
    description: achievements.map(describeAchievement).join(" · "),
  });
}
