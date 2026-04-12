import type { TrainingContext } from "../../gemini/index";
import { calculateStreak } from "../../routeUtils";
import { storage } from "../../storage";
import { computeCurrentWeek,computeExerciseGaps, computePlanPhase, computeProgressionFlags, computeRpeTrend, computeWeeklyVolume } from "./coachingInsights";
import { calculateTrainingStats, collectRecentWorkouts, getExerciseBreakdown, getStructuredExerciseStats } from "./trainingStats";

export async function buildTrainingContext(userId: string): Promise<TrainingContext> {
  // Limit timeline to 60 recent entries — sufficient for stats, streak
  // calculation, and the 10 most recent workouts shown to the AI. Avoids
  // fetching the full 500-entry default for heavy users.
  const [timeline, activePlanRecord, user, upcomingDays] = await Promise.all([
    storage.timeline.getTimeline(userId, undefined, 60),
    storage.plans.getActivePlan(userId),
    storage.users.getUser(userId),
    storage.timeline.getUpcomingPlannedDays(userId, 7),
  ]);

  const { completedWorkouts, plannedWorkouts, missedWorkouts, skippedWorkouts, totalWorkouts, completionRate, completedDates } = calculateTrainingStats(timeline);
  const exerciseBreakdown = getExerciseBreakdown(timeline);
  const currentStreak = calculateStreak(completedDates);
  const recentWorkouts = collectRecentWorkouts(timeline);
  const structuredExerciseStats = getStructuredExerciseStats(timeline);

  let activePlan: TrainingContext["activePlan"];
  if (activePlanRecord) {
    const currentWeek = computeCurrentWeek(activePlanRecord.startDate, activePlanRecord.totalWeeks);
    activePlan = { name: activePlanRecord.name, totalWeeks: activePlanRecord.totalWeeks, currentWeek, goal: activePlanRecord.goal ?? undefined };
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
    upcomingWorkouts: upcomingDays.map(d => ({
      planDayId: d.planDayId,
      date: d.date,
      focus: d.focus,
      mainWorkout: d.mainWorkout,
      accessory: d.accessory,
      notes: d.notes,
    })),
    exerciseBreakdown,
    structuredExerciseStats,
    activePlan,
    coachingInsights,
  };
}
