import type { TrainingContext } from "../../gemini/index";
import { logger } from "../../logger";
import { calculateStreak } from "../../routeUtils";
import { storage } from "../../storage";
import { computeCurrentWeek,computeExerciseGaps, computePlanPhase, computeProgressionFlags, computeRpeTrend, computeWeeklyVolume } from "./coachingInsights";
import { decideTrainingState } from "./trainingDecisionEngine";
import { calculateTrainingStats, collectRecentWorkouts, getExerciseBreakdown, getStructuredExerciseStats } from "./trainingStats";

function mapTestTrendDirection(
  trend: ReturnType<typeof computeRpeTrend>["rpeTrend"],
): "declining" | "improving" | "flat" | "insufficient_data" {
  const trendDirectionMap: Record<ReturnType<typeof computeRpeTrend>["rpeTrend"], "declining" | "improving" | "flat" | "insufficient_data"> = {
    rising: "declining",
    falling: "improving",
    stable: "flat",
    insufficient_data: "insufficient_data",
  };

  return trendDirectionMap[trend];
}

export async function buildTrainingContext(userId: string): Promise<TrainingContext> {
  const [timeline, activePlanRecord, user, upcomingDays] = await Promise.all([
    storage.timeline.getTimeline(userId),
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
  const completedLast7d = recentWorkouts.filter((w) => {
    const days = Math.floor((Date.now() - new Date(w.date).getTime()) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 7;
  }).length;
  let experienceLevel: "beginner" | "intermediate" | "advanced";
  if (totalWorkouts < 20) {
    experienceLevel = "beginner";
  } else if (totalWorkouts < 80) {
    experienceLevel = "intermediate";
  } else {
    experienceLevel = "advanced";
  }

  const decisionTree = decideTrainingState({
    profile: {
      experienceLevel,
      primaryGoal: "improve",
    },
    latestWorkouts: { completedLast7d, avgRpeLast3: rpeTrend.avgRpeLast3 },
    testTrend: {
      direction: mapTestTrendDirection(rpeTrend.rpeTrend),
    },
    raceContext: { hasRace: false, daysToRace: null },
    recoveryMarkers: {
      sleepQuality: "ok",
      soreness: rpeTrend.fatigueFlag ? "high" : "low",
      restingHrDelta: 0,
      illnessFlag: false,
    },
  });

  const coachingInsights: TrainingContext["coachingInsights"] = {
    ...rpeTrend,
    stationGaps,
    planPhase,
    weeklyVolume,
    progressionFlags,
    decisionTree: {
      currentPhase: decisionTree.phase,
      allowedWorkoutTypes: decisionTree.allowedWorkoutTypes,
      intensityPermitted: decisionTree.intensityPermitted,
      rationaleCodes: decisionTree.rationaleCodes,
    },
  };

  logger.info({
    context: "health-metrics",
    event: "phase_state_evaluated",
    userId,
    phase: decisionTree.phase,
    intensityPermitted: decisionTree.intensityPermitted,
    rationaleCodes: decisionTree.rationaleCodes,
  }, "Training phase decision evaluated");

  if (!decisionTree.intensityPermitted && decisionTree.phase === "performance") {
    logger.info({
      context: "health-metrics",
      event: "strict_phase_intensity_blocked",
      userId,
      phase: decisionTree.phase,
    }, "Intensity recommendation blocked in strict phase");
  }

  return {
    totalWorkouts,
    completedWorkouts,
    plannedWorkouts,
    missedWorkouts,
    skippedWorkouts,
    completionRate,
    currentStreak,
    weeklyGoal: user?.weeklyGoal ?? undefined,
    ...(user?.weightUnit ? { weightUnit: user.weightUnit } : {}),
    ...(user?.distanceUnit ? { distanceUnit: user.distanceUnit } : {}),
    recentWorkouts: recentWorkouts.slice(0, 10),
    upcomingWorkouts: upcomingDays.map(d => ({
      planDayId: d.planDayId,
      date: d.date,
      focus: d.focus,
      mainWorkout: d.mainWorkout,
      accessory: d.accessory,
      notes: d.notes,
      ...((d.exerciseSets?.length ?? 0) > 0
        ? {
            exerciseDetails: d.exerciseSets!.map(es => ({
              exerciseName: es.exerciseName,
              customLabel: es.customLabel,
              category: es.category,
              setNumber: es.setNumber,
              reps: es.reps,
              weight: es.weight,
              distance: es.distance,
              time: es.time,
              notes: es.notes,
              sortOrder: es.sortOrder,
            })),
          }
        : {}),
    })),
    exerciseBreakdown,
    structuredExerciseStats,
    activePlan,
    coachingInsights,
  };
}
