import { z } from "zod";
import { logger } from "../logger";
import { SUGGESTIONS_PROMPT } from "../prompts";
import { getAiClient, GEMINI_MODEL, retryWithBackoff, truncate } from "./client";
import type { TrainingContext } from "./types";


export interface UpcomingWorkout {
  id: string;
  date: string;
  focus: string;
  mainWorkout: string;
  accessory?: string;
  notes?: string;
}

export interface WorkoutSuggestion {
  workoutId: string;
  workoutDate: string;
  workoutFocus: string;
  targetField: "mainWorkout" | "accessory" | "notes";
  action: "replace" | "append";
  recommendation: string;
  rationale: string;
  priority: "high" | "medium" | "low";
}

export const workoutSuggestionSchema = z.object({
  workoutId: z.string(),
  workoutDate: z.string(),
  workoutFocus: z.string(),
  targetField: z.enum(["mainWorkout", "accessory", "notes"]),
  action: z.enum(["replace", "append"]),
  recommendation: z.string(),
  rationale: z.string(),
  priority: z.enum(["high", "medium", "low"]),
});

function parseAndValidateSuggestions(text: string): WorkoutSuggestion[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (parseErr) {
    logger.error({ err: parseErr, rawResponse: truncate(text) }, "[gemini] suggestions JSON.parse failed.");
    return [];
  }

  const rawArray = Array.isArray(raw) ? raw : [];
  const validated: WorkoutSuggestion[] = [];
  for (const item of rawArray) {
    const result = workoutSuggestionSchema.safeParse(item);
    if (result.success) {
      validated.push(result.data);
    } else {
      logger.warn({ issues: result.error.issues, item: JSON.stringify(item).slice(0, 200) }, "[gemini] Dropping invalid suggestion:");
    }
  }
  return validated;
}

function buildSuggestionsPrompt(
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[],
  planGoal?: string,
  coachingMaterials?: string,
): string {
  let prompt = `--- ATHLETE'S TRAINING DATA ---\n`;
  if (planGoal) {
    prompt += `Athlete's goal: ${planGoal}\n`;
  }
  prompt += `Completion rate: ${trainingContext.completionRate}%\n`;
  prompt += `Current streak: ${trainingContext.currentStreak} days\n`;
  prompt += `Completed workouts: ${trainingContext.completedWorkouts}\n`;
  if (trainingContext.weeklyGoal) {
    prompt += `Weekly goal: ${trainingContext.weeklyGoal} workouts/week\n`;
  }

  if (Object.keys(trainingContext.exerciseBreakdown).length > 0) {
    prompt += `\nExercise frequency:\n`;
    for (const [exercise, count] of Object.entries(
      trainingContext.exerciseBreakdown,
    )) {
      prompt += `- ${exercise}: ${count}x\n`;
    }
  }

  if (trainingContext.structuredExerciseStats && Object.keys(trainingContext.structuredExerciseStats).length > 0) {
    prompt += `\nExercise performance stats:\n`;
    for (const [exercise, stats] of Object.entries(trainingContext.structuredExerciseStats)) {
      let line = `- ${exercise}: trained ${stats.count}x`;
      if (stats.maxWeight) line += `, max weight: ${stats.maxWeight}`;
      if (stats.maxDistance) line += `, max distance: ${stats.maxDistance}m`;
      if (stats.bestTime) line += `, best time: ${stats.bestTime}min`;
      if (stats.avgReps) line += `, avg reps: ${stats.avgReps}`;
      prompt += line + "\n";
    }
  }

  if (trainingContext.recentWorkouts.length > 0) {
    prompt += `\nRecent completed workouts:\n`;
    for (const workout of trainingContext.recentWorkouts.slice(0, 10)) {
      let line = `- ${workout.date}: ${workout.focus} - ${workout.mainWorkout}`;
      const meta: string[] = [];
      if (workout.rpe != null) meta.push(`RPE: ${workout.rpe}`);
      if (workout.duration != null) meta.push(`Duration: ${workout.duration}min`);
      if (meta.length > 0) line += ` (${meta.join(", ")})`;
      prompt += line + "\n";
    }
  }

  prompt += `\n--- UPCOMING WORKOUTS ---\n`;
  for (const workout of upcomingWorkouts) {
    prompt += `ID: ${workout.id}, Date: ${workout.date}, Focus: ${workout.focus}, Main: ${workout.mainWorkout}`;
    if (workout.accessory) prompt += `, Accessory: ${workout.accessory}`;
    if (workout.notes) prompt += `, Notes: ${workout.notes}`;
    prompt += "\n";
  }

  if (coachingMaterials) {
    prompt += `\n${coachingMaterials}`;
  }

  prompt += `\nAnalyze the data and decide whether modifications are needed. Return [] if the plan is already well-structured.`;
  return prompt;
}

export async function generateWorkoutSuggestions(
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[],
  planGoal?: string,
  coachingMaterials?: string,
): Promise<WorkoutSuggestion[]> {
  try {
    if (upcomingWorkouts.length === 0) {
      return [];
    }

    const prompt = buildSuggestionsPrompt(trainingContext, upcomingWorkouts, planGoal, coachingMaterials);

    const response = await retryWithBackoff(
      () =>
        getAiClient().models.generateContent({
          model: GEMINI_MODEL,
          config: {
            systemInstruction: SUGGESTIONS_PROMPT,
            responseMimeType: "application/json",
          },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      "suggestions",
    );

    const text = response.text || "[]";

    return parseAndValidateSuggestions(text);
  } catch (error) {
    logger.error({ err: error }, "[gemini] suggestions error:");
    return [];
  }
}
