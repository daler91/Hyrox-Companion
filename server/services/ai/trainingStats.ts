import {
  storedDistanceToDisplay,
  storedWeightToDisplay,
  type UnitPreferences,
} from "@shared/unitConversion";

import type { TrainingContext } from "../../gemini/index";
import { FUNCTIONAL_EXERCISES } from "../../prompts";
import type { TimelineEntry } from "./types";

export function calculateTrainingStats(timeline: TimelineEntry[]) {
  let completedWorkouts = 0;
  let plannedWorkouts = 0;
  let missedWorkouts = 0;
  let skippedWorkouts = 0;
  let letGoWorkouts = 0;
  const completedDates = new Set<string>();

  for (const entry of timeline) {
    if (entry.status === "completed") {
      completedWorkouts++;
      if (entry.date) completedDates.add(entry.date);
    } else if (entry.status === "planned") {
      plannedWorkouts++;
    } else if (entry.status === "missed") {
      // Missed and then let go on purpose (missed-session recovery): the
      // athlete adjusted the plan, so it is neither a miss nor in the rate.
      if (entry.recovery === "let_go") letGoWorkouts++;
      else missedWorkouts++;
    } else if (entry.status === "skipped") {
      skippedWorkouts++;
    }
  }

  const totalWorkouts = completedWorkouts + plannedWorkouts + missedWorkouts + skippedWorkouts + letGoWorkouts;
  const denominator = completedWorkouts + missedWorkouts + skippedWorkouts;
  const completionRate = denominator > 0 ? Math.round((completedWorkouts / denominator) * 100) : 0;

  return {
    completedWorkouts,
    plannedWorkouts,
    missedWorkouts,
    skippedWorkouts,
    letGoWorkouts,
    totalWorkouts,
    completionRate,
    completedDates,
  };
}

/**
 * The sessions the athlete has actually done: completed entries dated today or
 * earlier. The experience level and the coverage-history gate read this, not
 * `totalWorkouts`, which also counts every planned day in the window — the
 * rest of the plan. A new athlete with a 12-week, 6-day plan and one logged
 * session counted as 73 and was coached as intermediate.
 * AI11 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function countCompletedThrough(timeline: TimelineEntry[], today: string): number {
  let count = 0;
  for (const entry of timeline) {
    if (entry.status === "completed" && entry.date && entry.date <= today) count++;
  }
  return count;
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

const MAX_RECENT_SKIPS = 5;

/**
 * The skipped days whose reason the athlete volunteered, newest first, capped.
 *
 * Skipped days never enter `recentWorkouts` (it collects completions only), so
 * before this the coach saw an aggregate skip count and nothing else — the
 * athlete could tap "injured" on the skip dialog and the reason reached no
 * prompt. Reasonless skips stay out: the athlete chose not to explain, and a
 * bare "skipped Tuesday" line adds nudge-fuel without coaching signal.
 */
export function collectRecentSkips(
  timeline: TimelineEntry[],
): NonNullable<TrainingContext["coachingInsights"]>["recentSkips"] {
  return timeline
    .filter(
      (entry): entry is TimelineEntry & { date: string } =>
        entry.status === "skipped" && Boolean(entry.date) && entry.skipReason != null,
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_RECENT_SKIPS)
    .map((entry) => ({
      date: entry.date,
      focus: entry.focus || "",
      reason: entry.skipReason as NonNullable<TimelineEntry["skipReason"]>,
    }));
}

const MAX_RECENT_MISSES = 5;

/**
 * The missed sessions worth a coach's attention, newest first, capped: key
 * and supporting ones, with whether the athlete let each go. Optional misses
 * and rest days stay out — the plan never needed them — and a folded or
 * shortened session has moved to a later day, so it is not a miss any more.
 */
export function collectRecentMisses(
  timeline: TimelineEntry[],
): NonNullable<TrainingContext["coachingInsights"]>["recentMisses"] {
  return timeline
    .filter(
      (entry): entry is TimelineEntry & { date: string; priority: "key" | "supporting" } =>
        entry.status === "missed" &&
        Boolean(entry.date) &&
        (entry.priority === "key" || entry.priority === "supporting"),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_RECENT_MISSES)
    .map((entry) => ({
      date: entry.date,
      focus: entry.focus || "",
      priority: entry.priority,
      decision: entry.recovery === "let_go" ? "let_go" : "undecided",
    }));
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
        athleteNote: entry.notes,
        exerciseDetails: entry.exerciseSets?.map(es => ({
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
          // The L4 stamp, so the prompt formatter converts the raw values into
          // the athlete's current units before labelling them (AI9).
          weightUnit: es.weightUnit,
          distanceUnit: es.distanceUnit,
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

/** The set with its weight and distance read through its own L4 stamp (AI9). */
function setInDisplayUnits(
  es: NonNullable<TimelineEntry["exerciseSets"]>[number],
  preferences: UnitPreferences,
) {
  return {
    ...es,
    weight: es.weight == null ? null : storedWeightToDisplay(es.weight, es, preferences),
    distance: es.distance == null ? null : storedDistanceToDisplay(es.distance, es, preferences),
  };
}

/**
 * Per-exercise bests for the coach, in the athlete's CURRENT units (the prompt
 * labels them so). Each row is converted through its L4 stamp before the max:
 * comparing raw values across a kg/lbs switch both picked the wrong row and
 * labelled a kg max as lbs — AI9 (CODEBASE_ANALYSIS_2026-10-03).
 */
export function getStructuredExerciseStats(timeline: TimelineEntry[], preferences: UnitPreferences) {
  const stats: Record<string, { count: number; maxWeight?: number; maxDistance?: number; bestTime?: number; avgReps?: number }> = {};
  let hasStats = false;

  for (const entry of timeline) {
    if (entry.status === "completed" && entry.exerciseSets) {
      for (const es of entry.exerciseSets) {
        hasStats = true;
        if (!stats[es.exerciseName]) stats[es.exerciseName] = { count: 0 };
        updateExerciseStat(stats[es.exerciseName], setInDisplayUnits(es, preferences));
      }
    }
  }

  return hasStats ? stats : undefined;
}
