import { dayDiff } from "@shared/dateUtils";
import { formatMinutes, minutes } from "@shared/units";

import type { TrainingContext } from "../gemini/types";
import { sanitizeUserInput } from "../utils/sanitize";
import { formatExerciseSetsForPrompt } from "./exerciseSetFormatter";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Human "today/tomorrow/yesterday/in N days" suffix for a workout date relative
 * to the athlete's current local date, e.g. " (today)" or " (in 2 days)". The
 * coach reads dates straight from the data, so spelling out the offset stops it
 * from re-deriving the date and calling today's session "tomorrow". Returns an
 * empty string when either date is missing or not a plain YYYY-MM-DD value.
 */
export function relativeDayLabel(date: string, currentDate?: string): string {
  if (!currentDate || !ISO_DATE.test(date) || !ISO_DATE.test(currentDate)) return "";
  const diff = dayDiff(currentDate, date);
  if (diff === 0) return " (today)";
  if (diff === 1) return " (tomorrow)";
  if (diff === -1) return " (yesterday)";
  if (diff > 1) return ` (in ${diff} days)`;
  return ` (${-diff} days ago)`;
}

/**
 * Tells the coach the athlete's current local date so "today"/"tomorrow" are
 * anchored to the calendar rather than inferred from the most recent workout.
 */
export function buildCurrentDateContext(trainingContext: TrainingContext): string {
  if (!trainingContext.currentDate) return "";
  return `\nToday's date: ${trainingContext.currentDate}. Treat this as "today" when discussing workout timing — the dated workouts below are annotated relative to it.`;
}

export function buildOverallStats(trainingContext: TrainingContext): string {
  let section = `\nOverall Stats:
- Total workouts tracked: ${trainingContext.totalWorkouts}
- Completed: ${trainingContext.completedWorkouts}
- Planned (upcoming): ${trainingContext.plannedWorkouts}
- Missed: ${trainingContext.missedWorkouts}
- Skipped: ${trainingContext.skippedWorkouts}
- Completion rate: ${trainingContext.completionRate}%
- Current streak: ${trainingContext.currentStreak} day${trainingContext.currentStreak === 1 ? "" : "s"}`;

  if (trainingContext.activePlan) {
    section += `\n\nActive Training Plan: "${sanitizeUserInput(trainingContext.activePlan.name)}" (${trainingContext.activePlan.totalWeeks} weeks)`;
    if (trainingContext.activePlan.goal) {
      section += `\nPlan Goal: ${sanitizeUserInput(trainingContext.activePlan.goal)}`;
    }
  }
  return section;
}

/**
 * Cap on the exercise-focus lines rendered into a prompt. The keys here are
 * athlete-authored `focus` text, not a fixed catalogue, so an athlete with
 * many distinct focus strings could otherwise push an unbounded section into
 * the prompt. The sibling renderers cap their lists the same way.
 */
const MAX_EXERCISE_FOCUS_ENTRIES = 20;

export function buildExerciseFocus(trainingContext: TrainingContext): string {
  const entries = Object.entries(trainingContext.exerciseBreakdown);
  if (entries.length === 0) return "";

  let section = `\n\nExercise Focus (times trained):`;
  // The key is the athlete's own `focus` string whenever it matches no known
  // functional exercise, so it is user-authored text reaching the SYSTEM
  // instruction and must be sanitized — buildRecentWorkouts below already
  // does exactly this to the same field (W1).
  for (const [exercise, count] of entries.slice(0, MAX_EXERCISE_FOCUS_ENTRIES)) {
    section += `\n- ${sanitizeUserInput(exercise)}: ${count}x`;
  }
  return section;
}

export function buildStructuredPerformance(trainingContext: TrainingContext): string {
  if (!trainingContext.structuredExerciseStats || Object.keys(trainingContext.structuredExerciseStats).length === 0) return "";

  let section = `\n\nStructured Exercise Performance:`;
  for (const [exercise, stats] of Object.entries(trainingContext.structuredExerciseStats)) {
    let line = `\n- ${exercise}: trained ${stats.count}x`;
    if (stats.maxWeight) line += `, max weight: ${stats.maxWeight}`;
    if (stats.maxDistance) line += `, max distance: ${stats.maxDistance}`;
    if (stats.bestTime) line += `, best time: ${formatMinutes(minutes(stats.bestTime))}`;
    if (stats.avgReps) line += `, avg reps: ${stats.avgReps}`;
    section += line;
  }
  return section;
}

export function buildRecentWorkouts(trainingContext: TrainingContext): string {
  if (trainingContext.recentWorkouts.length === 0) return "";

  let section = `\n\nRecent Workouts (last 7):`;
  for (const workout of trainingContext.recentWorkouts.slice(0, 7)) {
    const exerciseSummary = formatExerciseSetsForPrompt(workout.exerciseDetails, {
      weightUnit: trainingContext.weightUnit,
      distanceUnit: trainingContext.distanceUnit,
    });
    const workoutDetails = exerciseSummary
      ? `Exercises: ${exerciseSummary}`
      : sanitizeUserInput(workout.mainWorkout || "No details");
    let line = `\n- ${workout.date}${relativeDayLabel(workout.date, trainingContext.currentDate)}: ${sanitizeUserInput(workout.focus || "General")} - ${workoutDetails} (${workout.status})`;
    if (workout.athleteNote?.trim()) line += ` | Athlete note: ${sanitizeUserInput(workout.athleteNote.trim())}`;
    section += line;
  }
  return section;
}

export function buildUpcomingWorkouts(trainingContext: TrainingContext): string {
  if (!trainingContext.upcomingWorkouts || trainingContext.upcomingWorkouts.length === 0) return "";

  let section = `\n\nUpcoming Planned Workouts (next 7 days):`;
  for (const workout of trainingContext.upcomingWorkouts) {
    const exerciseSummary = formatExerciseSetsForPrompt(workout.exerciseDetails, {
      weightUnit: trainingContext.weightUnit,
      distanceUnit: trainingContext.distanceUnit,
    });
    let line = `\n- ${workout.date}${relativeDayLabel(workout.date, trainingContext.currentDate)}: ${sanitizeUserInput(workout.focus || "General")} - `;
    if (exerciseSummary) {
      line += `Exercises: ${exerciseSummary}`;
    } else {
      line += sanitizeUserInput(workout.mainWorkout || "No details");
      if (workout.accessory) line += ` | Accessory: ${sanitizeUserInput(workout.accessory)}`;
      if (workout.notes) line += ` | Notes: ${sanitizeUserInput(workout.notes)}`;
    }
    section += line;
  }
  return section;
}
