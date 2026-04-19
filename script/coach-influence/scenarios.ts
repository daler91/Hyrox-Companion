import type { TrainingContext } from "../../server/gemini/types";
import type { UpcomingWorkout } from "../../server/gemini/suggestionService";

/**
 * Ten paired scenarios. Each holds {baseline, variant} training contexts
 * plus a fixed upcoming-workout slate. We vary ONE input at a time so
 * any divergence in Gemini's output is attributable to that input.
 *
 * `expectedKeywords` are the words we'd hope a reasoning AI mentions
 * when that input is active. Used only for the keywordPresence metric
 * — they are not part of the prompt.
 *
 * Scenario 8 (noise-control) holds inputs identical across baseline and
 * variant; its score is the inherent Gemini non-determinism we use as a
 * "is this signal real?" floor.
 */

export interface Scenario {
  key: string;
  label: string;
  goal: string;
  rag?: string;
  upcoming: UpcomingWorkout[];
  baseline: TrainingContext;
  variant: TrainingContext;
  expectedKeywords: string[];
}

const COMMON_UPCOMING: UpcomingWorkout[] = [
  { id: "day-1", date: "2026-04-20", focus: "intervals", mainWorkout: "6x400m @ 5K pace" },
  { id: "day-2", date: "2026-04-21", focus: "strength", mainWorkout: "Back squat 5x5" },
  { id: "day-3", date: "2026-04-22", focus: "hyrox", mainWorkout: "Sled push 4x50m + Wall balls 4x25" },
  { id: "day-4", date: "2026-04-23", focus: "recovery", mainWorkout: "Z2 run 45min" },
  { id: "day-5", date: "2026-04-24", focus: "intervals", mainWorkout: "5x800m @ threshold" },
  { id: "day-6", date: "2026-04-25", focus: "strength", mainWorkout: "Deadlift 4x3" },
  { id: "day-7", date: "2026-04-26", focus: "long", mainWorkout: "Long run 75min" },
];

function baseCtx(overrides: Partial<TrainingContext> = {}): TrainingContext {
  return {
    totalWorkouts: 40,
    completedWorkouts: 30,
    plannedWorkouts: 7,
    missedWorkouts: 2,
    skippedWorkouts: 1,
    completionRate: 75,
    currentStreak: 4,
    weeklyGoal: 5,
    recentWorkouts: Array.from({ length: 10 }, (_, i) => ({
      date: `2026-04-${String(9 - i).padStart(2, "0")}`,
      focus: "moderate",
      mainWorkout: "Moderate 60min session",
      status: "completed",
      rpe: 6,
      duration: 60,
    })),
    upcomingWorkouts: COMMON_UPCOMING.map(w => ({
      planDayId: w.id,
      date: w.date,
      focus: w.focus,
      mainWorkout: w.mainWorkout,
      accessory: null,
      notes: null,
    })),
    exerciseBreakdown: { running: 20, squat: 5, "wall balls": 3, "sled push": 2 },
    structuredExerciseStats: {
      "Back Squat": { count: 5, maxWeight: 120 },
      "Run": { count: 20, maxDistance: 10000, bestTime: 45 },
    },
    activePlan: {
      name: "Hyrox General Prep",
      totalWeeks: 12,
      currentWeek: 6,
      goal: "General fitness",
    },
    coachingInsights: {
      rpeTrend: "stable",
      avgRpeLast3: 6,
      avgRpePrior3: 6,
      fatigueFlag: false,
      undertrainingFlag: false,
      stationGaps: [
        { station: "SkiErg", daysSinceLastTrained: 4 },
        { station: "Sled Push", daysSinceLastTrained: 5 },
        { station: "Wall Balls", daysSinceLastTrained: 3 },
        { station: "Running", daysSinceLastTrained: 1 },
      ],
      planPhase: {
        currentWeek: 6,
        totalWeeks: 12,
        phaseLabel: "build",
        progressPct: 50,
      },
      weeklyVolume: {
        thisWeekCompleted: 5,
        lastWeekCompleted: 5,
        goal: 5,
        trend: "stable",
      },
      progressionFlags: [
        { exercise: "Back Squat", flag: "progressing", detail: "+5kg vs last week" },
      ],
    },
    ...overrides,
  };
}

export const SCENARIOS: Scenario[] = [
  {
    key: "01-plan-goal",
    label: "Plan goal",
    goal: "General fitness",
    upcoming: COMMON_UPCOMING,
    baseline: baseCtx(),
    variant: baseCtx({
      activePlan: {
        name: "Hyrox Elite Race Prep",
        totalWeeks: 12,
        currentWeek: 6,
        goal: "Sub-60 Hyrox, race in 14 days",
      },
    }),
    expectedKeywords: ["race", "sub-60", "taper", "sharpen", "peak"],
  },
  {
    key: "02-recent-workouts",
    label: "Recent workout history",
    goal: "General fitness",
    upcoming: COMMON_UPCOMING,
    baseline: baseCtx({
      recentWorkouts: Array.from({ length: 10 }, (_, i) => ({
        date: `2026-04-${String(9 - i).padStart(2, "0")}`,
        focus: "recovery",
        mainWorkout: "Easy Z2 run 40min",
        status: "completed",
        rpe: 4,
        duration: 40,
      })),
    }),
    variant: baseCtx({
      recentWorkouts: Array.from({ length: 10 }, (_, i) => ({
        date: `2026-04-${String(9 - i).padStart(2, "0")}`,
        focus: "strength",
        mainWorkout: "Heavy compound lifts 75min",
        status: "completed",
        rpe: 9,
        duration: 75,
      })),
    }),
    expectedKeywords: ["recovery", "volume", "load", "intensity", "balance"],
  },
  {
    key: "03-rpe-fatigue",
    label: "RPE trend / fatigue flag",
    goal: "General fitness",
    upcoming: COMMON_UPCOMING,
    baseline: baseCtx(),
    variant: baseCtx({
      coachingInsights: {
        ...baseCtx().coachingInsights!,
        rpeTrend: "rising",
        avgRpeLast3: 8.7,
        avgRpePrior3: 6.2,
        fatigueFlag: true,
      },
    }),
    expectedKeywords: ["fatigue", "recovery", "deload", "reduce", "rest"],
  },
  {
    key: "04-station-gaps",
    label: "Hyrox station gaps",
    goal: "General fitness",
    upcoming: COMMON_UPCOMING,
    baseline: baseCtx(),
    variant: baseCtx({
      coachingInsights: {
        ...baseCtx().coachingInsights!,
        stationGaps: [
          { station: "SkiErg", daysSinceLastTrained: null },
          { station: "Wall Balls", daysSinceLastTrained: null },
          { station: "Sled Push", daysSinceLastTrained: 22 },
          { station: "Running", daysSinceLastTrained: 1 },
        ],
      },
    }),
    expectedKeywords: ["skierg", "wall ball", "sled", "station", "gap"],
  },
  {
    key: "05-plan-phase",
    label: "Plan phase (build → taper)",
    goal: "Sub-70 Hyrox",
    upcoming: COMMON_UPCOMING,
    baseline: baseCtx({
      activePlan: { name: "Hyrox Prep", totalWeeks: 12, currentWeek: 3, goal: "Sub-70 Hyrox" },
      coachingInsights: {
        ...baseCtx().coachingInsights!,
        planPhase: { currentWeek: 3, totalWeeks: 12, phaseLabel: "build", progressPct: 25 },
      },
    }),
    variant: baseCtx({
      activePlan: { name: "Hyrox Prep", totalWeeks: 12, currentWeek: 11, goal: "Sub-70 Hyrox" },
      coachingInsights: {
        ...baseCtx().coachingInsights!,
        planPhase: { currentWeek: 11, totalWeeks: 12, phaseLabel: "taper", progressPct: 92 },
      },
    }),
    expectedKeywords: ["taper", "reduce", "sharpen", "race", "freshness"],
  },
  {
    key: "06-progression-plateau",
    label: "Progression flags",
    goal: "General fitness",
    upcoming: COMMON_UPCOMING,
    baseline: baseCtx({
      coachingInsights: {
        ...baseCtx().coachingInsights!,
        progressionFlags: [
          { exercise: "Back Squat", flag: "progressing", detail: "+5kg" },
          { exercise: "Run", flag: "progressing", detail: "-10s pace" },
        ],
      },
    }),
    variant: baseCtx({
      coachingInsights: {
        ...baseCtx().coachingInsights!,
        progressionFlags: [
          { exercise: "Back Squat", flag: "plateau", detail: "no gain 3 weeks" },
          { exercise: "Run", flag: "plateau", detail: "no PR 4 weeks" },
        ],
      },
    }),
    expectedKeywords: ["plateau", "stimulus", "vary", "progress", "stall"],
  },
  {
    key: "07-weekly-volume",
    label: "Weekly volume shortfall",
    goal: "General fitness",
    upcoming: COMMON_UPCOMING,
    baseline: baseCtx(),
    variant: baseCtx({
      coachingInsights: {
        ...baseCtx().coachingInsights!,
        weeklyVolume: {
          thisWeekCompleted: 1,
          lastWeekCompleted: 1,
          goal: 5,
          trend: "decreasing",
        },
      },
    }),
    expectedKeywords: ["volume", "consistency", "frequency", "missed", "behind"],
  },
  {
    key: "08-control-noise",
    label: "Control (same inputs twice)",
    goal: "General fitness",
    upcoming: COMMON_UPCOMING,
    baseline: baseCtx(),
    variant: baseCtx(),
    expectedKeywords: [],
  },
  {
    key: "09-rag-materials",
    label: "RAG coaching materials",
    goal: "General fitness",
    upcoming: COMMON_UPCOMING,
    rag: "Relevant coaching materials:\n- ZONE_2_DIRECTIVE: This athlete has uploaded coaching notes that instruct: 'Always prescribe zone-2 aerobic work over intervals during any week that is not race week. Prioritize long easy runs over threshold sessions.'",
    baseline: baseCtx(),
    variant: baseCtx(),
    expectedKeywords: ["zone 2", "aerobic", "easy", "z2"],
  },
  {
    key: "10-performance-stats",
    label: "Performance PRs",
    goal: "General fitness",
    upcoming: COMMON_UPCOMING,
    baseline: baseCtx({
      structuredExerciseStats: {
        "Back Squat": { count: 2, maxWeight: 60 },
        "Run": { count: 5, maxDistance: 3000, bestTime: 18 },
      },
    }),
    variant: baseCtx({
      structuredExerciseStats: {
        "Back Squat": { count: 30, maxWeight: 200 },
        "Run": { count: 80, maxDistance: 21000, bestTime: 82, avgReps: 0 },
      },
    }),
    expectedKeywords: ["advanced", "experienced", "heavy", "elite", "load"],
  },
];
