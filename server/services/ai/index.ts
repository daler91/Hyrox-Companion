import { storage } from "../../storage";
import type { TrainingContext } from "../../gemini/index";
import { calculateStreak } from "../../routeUtils";
import { calculateTrainingStats, getExerciseBreakdown, collectRecentWorkouts, getStructuredExerciseStats } from "./trainingStats";
import { computeRpeTrend, computeExerciseGaps, computePlanPhase, computeWeeklyVolume, computeProgressionFlags, computeCurrentWeek } from "./coachingInsights";

export async function buildTrainingContext(userId: string): Promise<TrainingContext> {
  const [timeline, plans, user] = await Promise.all([
    storage.getTimeline(userId),
    storage.listTrainingPlans(userId),
    storage.getUser(userId),
  ]);

  const { completedWorkouts, plannedWorkouts, missedWorkouts, skippedWorkouts, totalWorkouts, completionRate, completedDates } = calculateTrainingStats(timeline);
  const exerciseBreakdown = getExerciseBreakdown(timeline);
  const currentStreak = calculateStreak(completedDates);
  const recentWorkouts = collectRecentWorkouts(timeline);
  const structuredExerciseStats = getStructuredExerciseStats(timeline);

  let activePlan: TrainingContext["activePlan"];
  if (plans.length > 0) {
    const currentWeek = computeCurrentWeek(timeline, plans[0].totalWeeks);
    activePlan = { name: plans[0].name, totalWeeks: plans[0].totalWeeks, currentWeek, goal: plans[0].goal ?? undefined };
  }

  const rpeTrend = computeRpeTrend(recentWorkouts);
  const stationGaps = computeExerciseGaps(timeline);
  const weeklyGoal = user?.weeklyGoal ?? 0;
  const planPhase = activePlan
    ? computePlanPhase(activePlan.totalWeeks, activePlan.currentWeek ?? 1)
    : undefined;
  const weeklyVolume = weeklyGoal > 0 ? computeWeeklyVolume(timeline, weeklyGoal) : undefined;
  const progressionFlags = computeProgressionFlags(timeline);

  const coachingInsights: TrainingContext["coachingInsights"] = {
    ...rpeTrend,
    stationGaps,
    planPhase,
    weeklyVolume,
    progressionFlags,
  };

  return {
    totalWorkouts,
    completedWorkouts,
    plannedWorkouts,
    missedWorkouts,
    skippedWorkouts,
    completionRate,
    currentStreak,
    weeklyGoal: user?.weeklyGoal ?? undefined,
    recentWorkouts: recentWorkouts.slice(0, 10),
    exerciseBreakdown,
    structuredExerciseStats,
    activePlan,
    coachingInsights,
  };
}
