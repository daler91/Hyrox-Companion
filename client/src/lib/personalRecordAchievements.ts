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

export function toastPersonalRecordAchievements(
  toast: ToastFn,
  achievements: readonly PersonalRecordAchievement[] | null | undefined,
): void {
  if (!achievements || achievements.length === 0) return;

  for (const achievement of achievements) {
    const exercise = getExerciseLabel(achievement.exerciseName, achievement.customLabel);
    toast({
      title: "New PR",
      description: `${exercise}: ${formatAchievementValue(achievement)}`,
    });
  }
}
