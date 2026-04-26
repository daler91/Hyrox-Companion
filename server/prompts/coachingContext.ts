import type { TrainingContext } from "../gemini/types";
import { formatExerciseSetsForPrompt } from "./exerciseSetFormatter";

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
    section += `\n\nActive Training Plan: "${trainingContext.activePlan.name}" (${trainingContext.activePlan.totalWeeks} weeks)`;
    if (trainingContext.activePlan.goal) {
      section += `\nPlan Goal: ${trainingContext.activePlan.goal}`;
    }
  }
  return section;
}

export function buildExerciseFocus(trainingContext: TrainingContext): string {
  if (Object.keys(trainingContext.exerciseBreakdown).length === 0) return "";

  let section = `\n\nExercise Focus (times trained):`;
  for (const [exercise, count] of Object.entries(trainingContext.exerciseBreakdown)) {
    section += `\n- ${exercise}: ${count}x`;
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
    if (stats.bestTime) line += `, best time: ${stats.bestTime}min`;
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
    });
    const workoutDetails = exerciseSummary
      ? `Exercises: ${exerciseSummary}`
      : workout.mainWorkout || "No details";
    let line = `\n- ${workout.date}: ${workout.focus || "General"} - ${workoutDetails} (${workout.status})`;
    if (workout.athleteNote?.trim()) line += ` | Athlete note: ${workout.athleteNote.trim()}`;
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
    });
    let line = `\n- ${workout.date}: ${workout.focus || "General"} - `;
    if (exerciseSummary) {
      line += `Exercises: ${exerciseSummary}`;
    } else {
      line += workout.mainWorkout || "No details";
      if (workout.accessory) line += ` | Accessory: ${workout.accessory}`;
      if (workout.notes) line += ` | Notes: ${workout.notes}`;
    }
    section += line;
  }
  return section;
}
