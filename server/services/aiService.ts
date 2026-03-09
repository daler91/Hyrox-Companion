import { storage } from "../storage";
import type { TrainingContext } from "../gemini";
import { calculateStreak } from "../routeUtils";
import { HYROX_EXERCISES } from "../prompts";

interface TimelineEntry {
  status?: string | null;
  date?: string | null;
  focus?: string | null;
  mainWorkout?: string | null;
  workoutLogId?: string | null;
  exerciseSets?: Array<{
    exerciseName: string;
    setNumber?: number | null;
    reps?: number | null;
    weight?: number | null;
    distance?: number | null;
    time?: number | null;
  }> | null;
}

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

function getExerciseBreakdown(timeline: TimelineEntry[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const entry of timeline) {
    if (entry.status === "completed" && entry.focus) {
      const focusLower = entry.focus.toLowerCase();
      let matched = false;
      for (const exercise of HYROX_EXERCISES) {
        if (focusLower.includes(exercise)) {
          breakdown[exercise] = (breakdown[exercise] || 0) + 1;
          matched = true;
        }
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
  recent.sort((a, b) => b.date.localeCompare(a.date));
  return recent;
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
    const stat = stats[es.exerciseName];
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

  return Object.keys(stats).length > 0 ? stats : undefined;
}

export async function buildTrainingContext(userId: string): Promise<TrainingContext> {
  const timeline = await storage.getTimeline(userId);
  const plans = await storage.listTrainingPlans(userId);

  const { completedWorkouts, plannedWorkouts, missedWorkouts, skippedWorkouts, totalWorkouts, completionRate, completedDates } = calculateTrainingStats(timeline);
  const exerciseBreakdown = getExerciseBreakdown(timeline);
  const currentStreak = calculateStreak(completedDates);
  const recentWorkouts = collectRecentWorkouts(timeline);
  const structuredExerciseStats = await getStructuredExerciseStats(timeline);

  let activePlan: TrainingContext["activePlan"];
  if (plans.length > 0) {
    activePlan = { name: plans[0].name, totalWeeks: plans[0].totalWeeks };
  }

  return {
    totalWorkouts,
    completedWorkouts,
    plannedWorkouts,
    missedWorkouts,
    skippedWorkouts,
    completionRate,
    currentStreak,
    recentWorkouts: recentWorkouts.slice(0, 10),
    exerciseBreakdown,
    structuredExerciseStats,
    activePlan,
  };
}
