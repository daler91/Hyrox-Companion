import type { TrainingContext } from "../../gemini/index";
import { FUNCTIONAL_EXERCISES } from "../../prompts";
import type { TimelineEntry } from "./types";

export function calculateTrainingStats(timeline: TimelineEntry[]) {
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

const functionalRegex = new RegExp(FUNCTIONAL_EXERCISES.join('|'), 'gi');

export function getExerciseBreakdown(timeline: TimelineEntry[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const entry of timeline) {
    if (entry.status === "completed" && entry.focus) {
      let matched = false;
      let match;
      functionalRegex.lastIndex = 0;

      // We only want to count each unique exercise ONCE per workout log entry
      // to match the previous string.includes() behavior.
      const seenInEntry = new Set<string>();

      while ((match = functionalRegex.exec(entry.focus)) !== null) {
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

export function collectRecentWorkouts(timeline: TimelineEntry[]): TrainingContext["recentWorkouts"] {
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

export function getStructuredExerciseStats(timeline: TimelineEntry[]) {
  const stats: Record<string, { count: number; maxWeight?: number; maxDistance?: number; bestTime?: number; avgReps?: number }> = {};
  let hasStats = false;

  for (const entry of timeline) {
    if (entry.status === "completed" && entry.exerciseSets) {
      for (const es of entry.exerciseSets) {
        hasStats = true;
        if (!stats[es.exerciseName]) stats[es.exerciseName] = { count: 0 };
        updateExerciseStat(stats[es.exerciseName], es);
      }
    }
  }

  return hasStats ? stats : undefined;
}
