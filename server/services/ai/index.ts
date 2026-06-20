import { AI_CONTEXT_TIMELINE_LIMIT } from "../../constants";
import type { TrainingContext } from "../../gemini/index";
import { logger } from "../../logger";
import { calculateStreak } from "../../routeUtils";
import { storage } from "../../storage";
import { calculateTrainingLoad } from "../trainingLoadService";
import {
  computeCurrentWeek,
  computeExerciseGaps,
  computePlanPhase,
  computeProgressionFlags,
  computeRpeTrend,
  computeWeeklyVolume,
} from "./coachingInsights";
import { summarizeMafTrend } from "./mafTrend";
import { buildNextSessionFuelling, buildNutritionTrainingContext } from "./nutritionContext";
import { decideTrainingState } from "./trainingDecisionEngine";
import {
  calculateTrainingStats,
  collectRecentWorkouts,
  getExerciseBreakdown,
  getStructuredExerciseStats,
} from "./trainingStats";

const DAY_MS = 24 * 60 * 60 * 1000;

function todayUtcDate(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .split("T")[0];
}

function addDays(date: string, delta: number): string {
  const timestamp = new Date(`${date}T00:00:00Z`).getTime() + delta * DAY_MS;
  return new Date(timestamp).toISOString().split("T")[0];
}

function mapTestTrendDirection(
  trend: ReturnType<typeof computeRpeTrend>["rpeTrend"],
): "declining" | "improving" | "flat" | "insufficient_data" {
  const trendDirectionMap: Record<
    ReturnType<typeof computeRpeTrend>["rpeTrend"],
    "declining" | "improving" | "flat" | "insufficient_data"
  > = {
    rising: "declining",
    falling: "improving",
    stable: "flat",
    insufficient_data: "insufficient_data",
  };

  return trendDirectionMap[trend];
}

function classifyExperienceLevel(totalWorkouts: number): "beginner" | "intermediate" | "advanced" {
  if (totalWorkouts < 20) return "beginner";
  if (totalWorkouts < 80) return "intermediate";
  return "advanced";
}

type UpcomingPlannedDay = Awaited<
  ReturnType<typeof storage.timeline.getUpcomingPlannedDays>
>[number];

/** Shape an upcoming plan day for the coach context, falling back to the planned
 *  prescription for sets that haven't been logged yet. */
function mapUpcomingWorkout(
  d: UpcomingPlannedDay,
): NonNullable<TrainingContext["upcomingWorkouts"]>[number] {
  return {
    planDayId: d.planDayId,
    date: d.date,
    focus: d.focus,
    mainWorkout: d.mainWorkout,
    accessory: d.accessory,
    notes: d.notes,
    aiSource: d.aiSource,
    aiRationale: d.aiRationale,
    aiNoteUpdatedAt: d.aiNoteUpdatedAt,
    aiInputsUsed: d.aiInputsUsed,
    ...((d.exerciseSets?.length ?? 0) > 0
      ? {
          // Upcoming plan-day sets carry their prescription in planned*
          // (actuals stay null until logged) — fall back so the coach sees
          // the prescribed numbers, not blanks.
          exerciseDetails: d.exerciseSets.map((es) => ({
            exerciseName: es.exerciseName,
            customLabel: es.customLabel,
            category: es.category,
            setNumber: es.setNumber,
            reps: es.reps ?? es.plannedReps,
            weight: es.weight ?? es.plannedWeight,
            distance: es.distance ?? es.plannedDistance,
            time: es.time ?? es.plannedTime,
            notes: es.notes,
            sortOrder: es.sortOrder,
          })),
        }
      : {}),
  };
}

export async function buildTrainingContext(userId: string): Promise<TrainingContext> {
  const today = todayUtcDate();
  const loadHistoryStart = addDays(today, -70);
  // Build the (optional) fuelling slice concurrently with the training reads; it
  // short-circuits to undefined when nutrition is off or the athlete has no data.
  const nutritionPromise = buildNutritionTrainingContext(userId);
  const [
    timeline,
    activePlanRecord,
    user,
    upcomingDays,
    loadWorkoutLogs,
    loadExerciseSets,
    loadTags,
  ] = await Promise.all([
    // Bound to recent history: this internal caller has no caller-supplied
    // limit, so an unbounded getTimeline() would hydrate the user's entire
    // history (all exercise sets) on every coach/chat context build. See
    // AI_CONTEXT_TIMELINE_LIMIT.
    storage.timeline.getTimeline(userId, undefined, AI_CONTEXT_TIMELINE_LIMIT),
    storage.plans.getActivePlan(userId),
    storage.users.getUser(userId),
    storage.timeline.getUpcomingPlannedDays(userId, 7),
    storage.analytics.getWorkoutLogsByDateRange(userId, loadHistoryStart, today),
    storage.analytics.getAllExerciseSetsWithDates(userId, loadHistoryStart, today),
    storage.analytics.getExerciseLoadTags(),
  ]);

  const {
    completedWorkouts,
    plannedWorkouts,
    missedWorkouts,
    skippedWorkouts,
    totalWorkouts,
    completionRate,
    completedDates,
  } = calculateTrainingStats(timeline);
  const exerciseBreakdown = getExerciseBreakdown(timeline);
  const currentStreak = calculateStreak(completedDates, user?.userTimezone);
  const recentWorkouts = collectRecentWorkouts(timeline);
  const structuredExerciseStats = getStructuredExerciseStats(timeline);

  let activePlan: TrainingContext["activePlan"];
  if (activePlanRecord) {
    const currentWeek = computeCurrentWeek(activePlanRecord.startDate, activePlanRecord.totalWeeks);
    activePlan = {
      name: activePlanRecord.name,
      totalWeeks: activePlanRecord.totalWeeks,
      currentWeek,
      goal: activePlanRecord.goal ?? undefined,
    };
  }

  const rpeTrend = computeRpeTrend(recentWorkouts);
  const stationGaps = computeExerciseGaps(timeline);
  const weeklyGoal = user?.weeklyGoal ?? 0;
  const planPhase = activePlan
    ? computePlanPhase(activePlan.totalWeeks, activePlan.currentWeek ?? 1)
    : undefined;
  const weeklyVolume = weeklyGoal > 0 ? computeWeeklyVolume(timeline, weeklyGoal) : undefined;
  const progressionFlags = computeProgressionFlags(timeline);
  const loadGovernor = calculateTrainingLoad(loadWorkoutLogs, loadExerciseSets, loadTags, {
    currentDate: today,
    weightUnit: user?.weightUnit || "kg",
    athlete: {
      age: user?.age ?? null,
      gender: user?.gender ?? null,
      restingHr: user?.restingHr ?? null,
      maxHr: user?.maxHr ?? null,
      ftp: user?.ftp ?? null,
    },
  }).overview;
  const completedLast7d = recentWorkouts.filter((w) => {
    const days = Math.floor((Date.now() - new Date(w.date).getTime()) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 7;
  }).length;
  const experienceLevel = classifyExperienceLevel(totalWorkouts);

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
    loadGovernor,
    decisionTree: {
      currentPhase: decisionTree.phase,
      allowedWorkoutTypes: decisionTree.allowedWorkoutTypes,
      intensityPermitted: decisionTree.intensityPermitted,
      rationaleCodes: decisionTree.rationaleCodes,
    },
  };

  // W6: omit userId from these info-level health lines. The logger's requestId
  // mixin already carries correlation, so we don't put a user identifier next
  // to health-derived phase/intensity status (matches the logger.ts S2 rule).
  logger.info(
    {
      context: "health-metrics",
      event: "phase_state_evaluated",
      phase: decisionTree.phase,
      intensityPermitted: decisionTree.intensityPermitted,
      rationaleCodes: decisionTree.rationaleCodes,
    },
    "Training phase decision evaluated",
  );

  if (!decisionTree.intensityPermitted && decisionTree.phase === "performance") {
    logger.info(
      {
        context: "health-metrics",
        event: "strict_phase_intensity_blocked",
        phase: decisionTree.phase,
      },
      "Intensity recommendation blocked in strict phase",
    );
  }

  // MAF athletes get a compact test-trend summary so the coach can validate
  // aerobic progress and nudge test cadence. The two reads are scoped to this
  // style and skipped entirely for everyone else.
  let mafTrend: TrainingContext["mafTrend"];
  if (user?.trainingStyleId === "maf_method") {
    const [mafTestRows, mafAnalysisRows] = await Promise.all([
      storage.mafTests.listTestResults(userId),
      storage.mafTests.listWorkoutAnalysis(userId),
    ]);
    mafTrend = summarizeMafTrend(mafTestRows, mafAnalysisRows);
  }

  const nutrition = await nutritionPromise;
  // Phase 3b: when the athlete engages with nutrition (slice present) and has an
  // upcoming planned session, tell the coach what to fuel for it.
  if (nutrition && upcomingDays.length > 0) {
    nutrition.nextSessionFuelling = buildNextSessionFuelling(
      upcomingDays[0],
      user?.bodyweightKg ?? null,
      user?.distanceUnit ?? "km",
    );
  }

  return {
    totalWorkouts,
    completedWorkouts,
    plannedWorkouts,
    missedWorkouts,
    skippedWorkouts,
    completionRate,
    currentStreak,
    mafHr: user?.mafHr ?? null,
    ...(mafTrend ? { mafTrend } : {}),
    weeklyGoal: user?.weeklyGoal ?? undefined,
    ...(user?.weightUnit ? { weightUnit: user.weightUnit } : {}),
    ...(user?.distanceUnit ? { distanceUnit: user.distanceUnit } : {}),
    ...(nutrition ? { nutrition } : {}),
    recentWorkouts: recentWorkouts.slice(0, 10),
    upcomingWorkouts: upcomingDays.map(mapUpcomingWorkout),
    exerciseBreakdown,
    structuredExerciseStats,
    activePlan,
    coachingInsights,
  };
}
