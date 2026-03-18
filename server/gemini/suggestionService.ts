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
): string {
  let prompt = `--- ATHLETE'S TRAINING DATA ---\n`;
  if (planGoal) {
    prompt += `Athlete's goal: ${planGoal}\n`;
  }
  prompt += `Completion rate: ${trainingContext.completionRate}%\n`;
  prompt += `Current streak: ${trainingContext.currentStreak} days\n`;
  prompt += `Completed workouts: ${trainingContext.completedWorkouts}\n`;

  if (Object.keys(trainingContext.exerciseBreakdown).length > 0) {
    prompt += `\nExercise frequency:\n`;
    for (const [exercise, count] of Object.entries(
      trainingContext.exerciseBreakdown,
    )) {
      prompt += `- ${exercise}: ${count}x\n`;
    }
  }

  if (trainingContext.recentWorkouts.length > 0) {
    prompt += `\nRecent completed workouts:\n`;
    for (const workout of trainingContext.recentWorkouts.slice(0, 10)) {
      prompt += `- ${workout.date}: ${workout.focus} - ${workout.mainWorkout}\n`;
    }
  }

  prompt += `\n--- UPCOMING WORKOUTS ---\n`;
  for (const workout of upcomingWorkouts) {
    prompt += `ID: ${workout.id}, Date: ${workout.date}, Focus: ${workout.focus}, Main: ${workout.mainWorkout}`;
    if (workout.accessory) prompt += `, Accessory: ${workout.accessory}`;
    prompt += "\n";
  }

  prompt += `\nAnalyze the data and provide suggestions for the upcoming workouts.`;
  return prompt;
}

export async function generateWorkoutSuggestions(
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[],
  planGoal?: string,
): Promise<WorkoutSuggestion[]> {
  try {
    if (upcomingWorkouts.length === 0) {
      return [];
    }

    const prompt = buildSuggestionsPrompt(trainingContext, upcomingWorkouts, planGoal);

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
