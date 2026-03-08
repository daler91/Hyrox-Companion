import { GoogleGenAI } from "@google/genai";
import {
  SUGGESTIONS_PROMPT,
  PARSE_EXERCISES_PROMPT,
  VALID_EXERCISE_NAMES,
  VALID_CATEGORIES,
  buildSystemPrompt,
} from "./prompts";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
  structuredExerciseStats?: Record<string, {
    count: number;
    maxWeight?: number;
    maxDistance?: number;
    bestTime?: number;
    avgReps?: number;
  }>;
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

export interface ParsedExercise {
  exerciseName: string;
  category: string;
  customLabel?: string;
  confidence?: number;
  sets: Array<{
    setNumber: number;
    reps?: number;
    weight?: number;
    distance?: number;
    time?: number;
  }>;
}

export async function generateWorkoutSuggestions(
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[]
): Promise<WorkoutSuggestion[]> {
  try {
    if (upcomingWorkouts.length === 0) {
      return [];
    }

    let prompt = `--- ATHLETE'S TRAINING DATA ---\n`;
    prompt += `Completion rate: ${trainingContext.completionRate}%\n`;
    prompt += `Current streak: ${trainingContext.currentStreak} days\n`;
    prompt += `Completed workouts: ${trainingContext.completedWorkouts}\n`;

    if (Object.keys(trainingContext.exerciseBreakdown).length > 0) {
      prompt += `\nExercise frequency:\n`;
      for (const [exercise, count] of Object.entries(trainingContext.exerciseBreakdown)) {
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
      prompt += `ID: ${workout.id}, Date: ${workout.date}, Focus: ${workout.focus}, Main: ${workout.mainWorkout}${workout.accessory ? `, Accessory: ${workout.accessory}` : ""}\n`;
    }

    prompt += `\nAnalyze the data and provide suggestions for the upcoming workouts.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: SUGGESTIONS_PROMPT,
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text = response.text || "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const suggestions = JSON.parse(jsonMatch[0]) as WorkoutSuggestion[];
    return suggestions.filter(s =>
      s.workoutId &&
      s.recommendation &&
      s.rationale &&
      s.priority &&
      ["mainWorkout", "accessory", "notes"].includes(s.targetField) &&
      ["replace", "append"].includes(s.action)
    );
  } catch (error) {
    console.error("Gemini suggestions error:", error);
    return [];
  }
}

export async function chatWithCoach(
  userMessage: string,
  conversationHistory: ChatMessage[] = [],
  trainingContext?: TrainingContext
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

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: systemPrompt,
      },
      contents: messages,
    });

    return response.text || "I apologize, but I couldn't generate a response. Please try again.";
  } catch (error) {
    console.error("Gemini API error:", error);
    throw new Error("Failed to get response from AI coach");
  }
}

export async function parseExercisesFromText(text: string, weightUnit: string = "kg", customExerciseNames?: string[]): Promise<ParsedExercise[]> {
  try {
    const unitNote = weightUnit === "lbs"
      ? `\nIMPORTANT: The user uses pounds (lbs) for weight. If they write "70" assume lbs. If they explicitly say "kg", convert to lbs (multiply by 2.2 and round). Return all weights in lbs.`
      : `\nThe user uses kilograms (kg) for weight. If they write "70" assume kg. If they explicitly say "lbs", convert to kg (divide by 2.2 and round). Return all weights in kg.`;

    let customNote = "";
    if (customExerciseNames && customExerciseNames.length > 0) {
      customNote = `\n\nThe user has previously saved these custom exercises. If you recognize any of them in the text, use "custom" as exerciseName and use the matching name as customLabel: ${customExerciseNames.join(", ")}`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: PARSE_EXERCISES_PROMPT + unitNote + customNote,
      },
      contents: [{ role: "user", parts: [{ text: `Parse this workout description into structured exercise data:\n\n${text}` }] }],
    });

    const responseText = response.text || "[]";
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]) as ParsedExercise[];
    return parsed.filter(ex =>
      ex.exerciseName &&
      ex.category &&
      ex.sets &&
      Array.isArray(ex.sets) &&
      ex.sets.length > 0
    ).map(ex => {
      const isKnown = VALID_EXERCISE_NAMES.has(ex.exerciseName);
      const validCategory = VALID_CATEGORIES.has(ex.category);
      const confidence = typeof ex.confidence === "number" ? Math.min(100, Math.max(0, Math.round(ex.confidence))) : (isKnown ? 95 : 50);
      return {
        exerciseName: isKnown ? ex.exerciseName : "custom",
        category: validCategory ? ex.category : "conditioning",
        customLabel: isKnown ? ex.customLabel : (ex.customLabel || ex.exerciseName),
        confidence,
        sets: ex.sets.map((s, i) => ({
          ...s,
          setNumber: s.setNumber || i + 1,
        })),
      };
    });
  } catch (error) {
    console.error("Gemini exercise parsing error:", error);
    throw new Error("Failed to parse exercises from text");
  }
}

export async function* streamChatWithCoach(
  userMessage: string,
  conversationHistory: ChatMessage[] = [],
  trainingContext?: TrainingContext
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

    const response = await ai.models.generateContentStream({
      model: "gemini-3-flash-preview",
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
    console.error("Gemini streaming API error:", error);
    throw new Error("Failed to get streaming response from AI coach");
  }
}
