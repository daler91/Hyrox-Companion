import type { TrainingContext } from "../gemini/types";

function formatExerciseDetails(exerciseDetails: NonNullable<TrainingContext["recentWorkouts"][0]["exerciseDetails"]>): string {
  type ExDetail = typeof exerciseDetails[0];
  const grouped = new Map<string, ExDetail[]>();
  for (const ex of exerciseDetails) {
    if (!grouped.has(ex.name)) grouped.set(ex.name, []);
    grouped.get(ex.name)!.push(ex);
  }
  const details: string[] = [];
  grouped.forEach((sets, name) => {
    const parts = [name];
    const firstSet = sets[0];
    const allSameReps = sets.every((s: ExDetail) => s.reps === firstSet.reps);
    if (allSameReps && firstSet.reps && sets.length > 1) parts.push(`${sets.length}x${firstSet.reps}`);
    else if (firstSet.reps) parts.push(`${sets.length > 1 ? sets.length + "x" : ""}${firstSet.reps}reps`);
    if (firstSet.weight) parts.push(`@${firstSet.weight}`);
    if (firstSet.distance) parts.push(`${firstSet.distance}m`);
    if (firstSet.time) parts.push(`${firstSet.time}min`);
    details.push(parts.join(" "));
  });
  return details.join(", ");
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
    let line = `\n- ${workout.date}: ${workout.focus || "General"} - ${workout.mainWorkout || "No details"} (${workout.status})`;
    if (workout.exerciseDetails && workout.exerciseDetails.length > 0) {
      line += ` [${formatExerciseDetails(workout.exerciseDetails)}]`;
    }
    section += line;
  }
  return section;
}

export function buildUpcomingWorkouts(trainingContext: TrainingContext): string {
  if (!trainingContext.upcomingWorkouts || trainingContext.upcomingWorkouts.length === 0) return "";

  let section = `\n\nUpcoming Planned Workouts (next 7 days):`;
  for (const workout of trainingContext.upcomingWorkouts) {
    let line = `\n- ${workout.date}: ${workout.focus || "General"} - ${workout.mainWorkout || "No details"}`;
    if (workout.accessory) line += ` | Accessory: ${workout.accessory}`;
    if (workout.notes) line += ` | Notes: ${workout.notes}`;
    section += line;
  }
  return section;
}
