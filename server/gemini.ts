import { GoogleGenAI } from "@google/genai";

// Blueprint: javascript_gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const BASE_SYSTEM_PROMPT = `You are an expert Hyrox training coach and AI assistant. You help athletes analyze their training data, provide insights, and suggest improvements for Hyrox competitions.

Hyrox is a fitness competition that combines running with functional workout stations:
- 8x 1km runs between stations
- SkiErg (1000m)
- Sled Push (50m)
- Sled Pull (50m)
- Burpee Broad Jumps (80m)
- Rowing (1000m)
- Farmers Carry (200m)
- Sandbag Lunges (100m)
- Wall Balls (75-100 reps)

When users ask about their training:
- Provide specific, actionable advice based on their actual training data when available
- Reference Hyrox-specific training principles
- Be encouraging but honest about areas for improvement
- Suggest workout structures and recovery strategies
- Help with pacing strategies and race-day preparation
- Identify training gaps (e.g., stations not practiced recently)
- Acknowledge their progress and consistency

Keep responses concise but informative. Use bullet points for lists.`;

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
  }>;
  exerciseBreakdown: Record<string, number>;
  activePlan?: {
    name: string;
    totalWeeks: number;
    currentWeek?: number;
  };
}

function buildSystemPrompt(trainingContext?: TrainingContext): string {
  if (!trainingContext || trainingContext.totalWorkouts === 0) {
    return BASE_SYSTEM_PROMPT + `\n\nNote: This athlete hasn't logged any training data yet. Encourage them to start tracking their workouts to receive personalized insights.`;
  }

  let contextSection = `\n\n--- ATHLETE'S TRAINING DATA ---\n`;
  
  contextSection += `\nOverall Stats:
- Total workouts tracked: ${trainingContext.totalWorkouts}
- Completed: ${trainingContext.completedWorkouts}
- Planned (upcoming): ${trainingContext.plannedWorkouts}
- Missed: ${trainingContext.missedWorkouts}
- Skipped: ${trainingContext.skippedWorkouts}
- Completion rate: ${trainingContext.completionRate}%
- Current streak: ${trainingContext.currentStreak} day${trainingContext.currentStreak !== 1 ? 's' : ''}`;

  if (trainingContext.activePlan) {
    contextSection += `\n\nActive Training Plan: "${trainingContext.activePlan.name}" (${trainingContext.activePlan.totalWeeks} weeks)`;
  }

  if (Object.keys(trainingContext.exerciseBreakdown).length > 0) {
    contextSection += `\n\nExercise Focus (times trained):`;
    for (const [exercise, count] of Object.entries(trainingContext.exerciseBreakdown)) {
      contextSection += `\n- ${exercise}: ${count}x`;
    }
  }

  if (trainingContext.recentWorkouts.length > 0) {
    contextSection += `\n\nRecent Workouts (last 7):`;
    for (const workout of trainingContext.recentWorkouts.slice(0, 7)) {
      contextSection += `\n- ${workout.date}: ${workout.focus || 'General'} - ${workout.mainWorkout || 'No details'} (${workout.status})`;
    }
  }

  contextSection += `\n\n--- END TRAINING DATA ---\n\nUse this data to provide personalized coaching. Reference specific workouts and patterns when relevant.`;

  return BASE_SYSTEM_PROMPT + contextSection;
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
      model: "gemini-2.5-flash",
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
