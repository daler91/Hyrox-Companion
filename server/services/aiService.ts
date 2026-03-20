import { storage } from "../storage";
import type { TrainingContext } from "../gemini/index";
import { calculateStreak } from "../routeUtils";
import { HYROX_EXERCISES } from "../prompts";

import type { TimelineEntry as SharedTimelineEntry } from "@shared/schema";

type TimelineEntry = Pick<
  SharedTimelineEntry,
  "status" | "date" | "focus" | "mainWorkout" | "workoutLogId" | "exerciseSets" | "rpe" | "duration"
>;

function calculateTrainingStats(timeline: TimelineEntry[]) {
  let completedWorkouts = 0;
  let plannedWorkouts = 0;
  let missedWorkouts = 0;
  let skippedWorkouts = 0;
  const completedDates = new Set<string>();

  for (const entry of timeline) {
    if (entry.status === "completed") {
      completedWorkouts++;
      if (entry.date) completedDates.add(entry.date);
    } else if (entry.status === "planned") {
      plannedWorkouts++;
    } else if (entry.status === "missed") {
      missedWorkouts++;
    } else if (entry.status === "skipped") {
      skippedWorkouts++;
    }
  }

  const totalWorkouts = completedWorkouts + plannedWorkouts + missedWorkouts + skippedWorkouts;
  const denominator = completedWorkouts + missedWorkouts + skippedWorkouts;
  const completionRate = denominator > 0 ? Math.round((completedWorkouts / denominator) * 100) : 0;

  return { completedWorkouts, plannedWorkouts, missedWorkouts, skippedWorkouts, totalWorkouts, completionRate, completedDates };
}

const hyroxRegex = new RegExp(HYROX_EXERCISES.join('|'), 'gi');

function getExerciseBreakdown(timeline: TimelineEntry[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const entry of timeline) {
    if (entry.status === "completed" && entry.focus) {
      let matched = false;
      let match;
      hyroxRegex.lastIndex = 0;

      // We only want to count each unique exercise ONCE per workout log entry
      // to match the previous string.includes() behavior.
      const seenInEntry = new Set<string>();

      while ((match = hyroxRegex.exec(entry.focus)) !== null) {
        const exercise = match[0].toLowerCase();
        if (!seenInEntry.has(exercise)) {
          seenInEntry.add(exercise);
          breakdown[exercise] = (breakdown[exercise] || 0) + 1;
        }
        matched = true;
      }
      if (!matched) {
        breakdown[entry.focus] = (breakdown[entry.focus] || 0) + 1;
      }
    }
  }
  return breakdown;
}

function collectRecentWorkouts(timeline: TimelineEntry[]): TrainingContext["recentWorkouts"] {
  const recent: TrainingContext["recentWorkouts"] = [];
  for (const entry of timeline) {
    if (entry.status === "completed" && entry.date) {
      recent.push({
        date: entry.date,
        focus: entry.focus || "",
        mainWorkout: entry.mainWorkout || "",
        status: entry.status,
        rpe: entry.rpe,
        duration: entry.duration,
        exerciseDetails: entry.exerciseSets?.map(es => ({
          name: es.exerciseName,
          setNumber: es.setNumber,
          reps: es.reps,
          weight: es.weight,
          distance: es.distance,
          time: es.time,
        })),
      });
    }
  }
  // Fast string comparison for YYYY-MM-DD dates instead of localeCompare
  recent.sort((a, b) => {
    if (b.date < a.date) return -1;
    if (b.date > a.date) return 1;
    return 0;
  });
  return recent;
}

function updateExerciseStat(
  stat: { count: number; maxWeight?: number; maxDistance?: number; bestTime?: number; avgReps?: number },
  es: { weight: number | null; distance: number | null; time: number | null; reps: number | null }
) {
  stat.count++;
  if (es.weight) {
    if (!stat.maxWeight || es.weight > stat.maxWeight) stat.maxWeight = es.weight;
  }
  if (es.distance) {
    if (!stat.maxDistance || es.distance > stat.maxDistance) stat.maxDistance = es.distance;
  }
  if (es.time) {
    if (!stat.bestTime || es.time < stat.bestTime) stat.bestTime = es.time;
  }
  if (es.reps) {
    stat.avgReps = stat.avgReps
      ? Math.round((stat.avgReps * (stat.count - 1) + es.reps) / stat.count)
      : es.reps;
  }
}

async function getStructuredExerciseStats(timeline: TimelineEntry[]) {
  const completedWorkoutLogIds = timeline
    .filter(e => e.status === "completed" && e.workoutLogId)
    .map(e => e.workoutLogId!);

  const stats: Record<string, { count: number; maxWeight?: number; maxDistance?: number; bestTime?: number; avgReps?: number }> = {};

  if (completedWorkoutLogIds.length === 0) return undefined;

  const allSets = await storage.getExerciseSetsByWorkoutLogs(completedWorkoutLogIds);
  for (const es of allSets) {
    if (!stats[es.exerciseName]) stats[es.exerciseName] = { count: 0 };
    updateExerciseStat(stats[es.exerciseName], es);
  }

  return Object.keys(stats).length > 0 ? stats : undefined;
}

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
  const structuredExerciseStats = await getStructuredExerciseStats(timeline);

  let activePlan: TrainingContext["activePlan"];
  if (plans.length > 0) {
    activePlan = { name: plans[0].name, totalWeeks: plans[0].totalWeeks, goal: plans[0].goal ?? undefined };
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
    recentWorkouts: recentWorkouts.slice(0, 10),
    exerciseBreakdown,
    structuredExerciseStats,
    activePlan,
  };
}
