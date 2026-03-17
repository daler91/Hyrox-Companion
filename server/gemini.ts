import { logger } from "./logger";
import { type ParsedExercise, exerciseSetSchema, type ChatMessage } from "@shared/schema";
export type { ChatMessage } from "@shared/schema";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  SUGGESTIONS_PROMPT,
  PARSE_EXERCISES_PROMPT,
  VALID_EXERCISE_NAMES,
  VALID_CATEGORIES,
  buildSystemPrompt,
} from "./prompts";

const GEMINI_MODEL = "gemini-3-flash-preview";

let _ai: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI {
  if (!_ai) {
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }
  return _ai;
}

export interface TrainingContext {
  totalWorkouts: number;
  completedWorkouts: number;
  plannedWorkouts: number;
  missedWorkouts: number;
  skippedWorkouts: number;
  completionRate: number;
  currentStreak: number;
  recentWorkouts: Array<{
    date: string;
    focus: string;
    mainWorkout: string;
    status: string;
    exerciseDetails?: Array<{
      name: string;
      setNumber?: number | null;
      reps?: number | null;
      weight?: number | null;
      distance?: number | null;
      time?: number | null;
    }>;
  }>;
  exerciseBreakdown: Record<string, number>;
  structuredExerciseStats?: Record<
    string,
    {
      count: number;
      maxWeight?: number;
      maxDistance?: number;
      bestTime?: number;
      avgReps?: number;
    }
  >;
  activePlan?: {
    name: string;
    totalWeeks: number;
    currentWeek?: number;
  };
}

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

export const parsedExerciseSchema = z.object({
  exerciseName: z.string(),
  category: z.string(),
  customLabel: z.string().optional().nullable(),
  confidence: z.number().min(0).max(100).optional().nullable(),
  missingFields: z.array(z.string()).optional().nullable(),
  sets: z.array(exerciseSetSchema).min(1),
});

export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("429") || msg.includes("rate limit")) return true;
    if (
      msg.includes("500") ||
      msg.includes("503") ||
      msg.includes("internal server error")
    )
      return true;
    if (
      msg.includes("network") ||
      msg.includes("econnreset") ||
      msg.includes("timeout") ||
      msg.includes("fetch failed")
    )
      return true;
  }
  return false;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = 2,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries && isRetryableError(error)) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        logger.warn({ err: error instanceof Error ? error.message : error }, `[gemini] ${label} attempt ${attempt + 1} failed (retrying in ${delay}ms):`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        break;
      }
    }
  }
  throw lastError;
}

function truncate(text: string, maxLen: number = 500): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

function parseAndValidateSuggestions(text: string): WorkoutSuggestion[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (parseErr) {
    console.error(
      "[gemini] suggestions JSON.parse failed. Raw response:",
      truncate(text),
    );
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
): string {
  let prompt = `--- ATHLETE'S TRAINING DATA ---\n`;
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
): Promise<WorkoutSuggestion[]> {
  try {
    if (upcomingWorkouts.length === 0) {
      return [];
    }

    const prompt = buildSuggestionsPrompt(trainingContext, upcomingWorkouts);

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

export async function chatWithCoach(
  userMessage: string,
  conversationHistory: Pick<ChatMessage, "role" | "content">[] = [],
  trainingContext?: TrainingContext,
): Promise<string> {
  try {
    const messages = conversationHistory.map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    messages.push({
      role: "user",
      parts: [{ text: userMessage }],
    });

    const systemPrompt = buildSystemPrompt(trainingContext);

    const response = await getAiClient().models.generateContent({
      model: GEMINI_MODEL,
      config: {
        systemInstruction: systemPrompt,
      },
      contents: messages,
    });

    return (
      response.text ||
      "I apologize, but I couldn't generate a response. Please try again."
    );
  } catch (error) {
    logger.error({ err: error }, "Gemini API error:");
    throw new Error("Failed to get response from AI coach");
  }
}

export async function parseExercisesFromText(
  text: string,
  weightUnit: string = "kg",
  customExerciseNames?: string[],
): Promise<ParsedExercise[]> {
  try {
    const unitNote =
      weightUnit === "lbs"
        ? `\nIMPORTANT: The user uses pounds (lbs) for weight. If they write "70" assume lbs. \
If they explicitly say "kg", convert to lbs (multiply by 2.2 and round). Return all weights in lbs.`
        : `\nThe user uses kilograms (kg) for weight. If they write "70" assume kg. \
If they explicitly say "lbs", convert to kg (divide by 2.2 and round). Return all weights in kg.`;

    let customNote = "";
    if (customExerciseNames && customExerciseNames.length > 0) {
      customNote = `\n\nThe user has previously saved these custom exercises. \
If you recognize any of them in the text, use "custom" as exerciseName \
and use the matching name as customLabel: ${customExerciseNames.join(", ")}`;
    }

    const response = await retryWithBackoff(
      () =>
        getAiClient().models.generateContent({
          model: GEMINI_MODEL,
          config: {
            systemInstruction: PARSE_EXERCISES_PROMPT + unitNote + customNote,
            responseMimeType: "application/json",
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Parse this workout description into structured exercise data:\n\n${text}`,
                },
              ],
            },
          ],
        }),
      "exercise-parse",
    );

    const responseText = response.text || "[]";

    let raw: unknown;
    try {
      raw = JSON.parse(responseText);
    } catch (parseErr) {
      console.error(
        "[gemini] exercise-parse JSON.parse failed. Raw response:",
        truncate(responseText),
      );
      throw new Error("AI returned invalid JSON for exercise parsing");
    }

    const rawArray = Array.isArray(raw) ? raw : [];
    const zodResult = z.array(parsedExerciseSchema).safeParse(rawArray);

    if (!zodResult.success) {
      console.error(
        "[gemini] exercise-parse Zod validation failed:",
        zodResult.error.issues,
      );
      console.error(
        "[gemini] Raw parsed data:",
        truncate(JSON.stringify(rawArray)),
      );
      throw new Error("AI returned malformed exercise data");
    }

    return zodResult.data.map((ex) => {
      const isKnown = VALID_EXERCISE_NAMES.has(ex.exerciseName);
      const validCategory = VALID_CATEGORIES.has(ex.category);
      let confidence = isKnown ? 95 : 50;
      if (typeof ex.confidence === "number" && ex.confidence !== null) {
        confidence = Math.min(100, Math.max(0, Math.round(ex.confidence)));
      }
      return {
        exerciseName: isKnown ? ex.exerciseName : "custom",
        category: validCategory ? ex.category : "conditioning",
        customLabel: isKnown
          ? ex.customLabel || undefined
          : ex.customLabel || ex.exerciseName,
        confidence,
        missingFields: Array.isArray(ex.missingFields)
          ? ex.missingFields.filter(
              (f) => typeof f === "string" && f.length > 0,
            )
          : undefined,
        sets: ex.sets.map((s, i) => ({
          setNumber: s.setNumber || i + 1,
          ...(s.reps != null && { reps: s.reps }),
          ...(s.weight != null && { weight: s.weight }),
          ...(s.distance != null && { distance: s.distance }),
          ...(s.time != null && { time: s.time }),
        })),
      };
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "AI returned invalid JSON for exercise parsing" ||
        error.message === "AI returned malformed exercise data")
    ) {
      throw error;
    }
    logger.error({ err: error }, "[gemini] exercise-parse error:");
    throw new Error("Failed to parse exercises from text");
  }
}

export async function* streamChatWithCoach(
  userMessage: string,
  conversationHistory: Pick<ChatMessage, "role" | "content">[] = [],
  trainingContext?: TrainingContext,
): AsyncGenerator<string> {
  try {
    const messages = conversationHistory.map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    messages.push({
      role: "user",
      parts: [{ text: userMessage }],
    });

    const systemPrompt = buildSystemPrompt(trainingContext);

    const response = await getAiClient().models.generateContentStream({
      model: GEMINI_MODEL,
      config: {
        systemInstruction: systemPrompt,
      },
      contents: messages,
    });

    for await (const chunk of response) {
      const text = chunk.text;
      if (text) {
        yield text;
      }
    }
  } catch (error) {
    logger.error({ err: error }, "Gemini streaming API error:");
    throw new Error("Failed to get streaming response from AI coach");
  }
}
