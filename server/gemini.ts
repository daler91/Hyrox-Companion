import { GoogleGenAI } from "@google/genai";

// Blueprint: javascript_gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const BASE_SYSTEM_PROMPT = `You are an expert Hyrox training coach and AI assistant. You help athletes analyze their training data, provide insights, and suggest improvements for Hyrox competitions.

Hyrox is a fitness competition that combines running with functional workout stations:
- 8x 1km runs between stations 1-8 below
- 1.SkiErg (1000m)
- 2.Sled Push (50m)
- 3.Sled Pull (50m)
- 4.Burpee Broad Jumps (80m)
- 5.Rowing (1000m)
- 6.Farmers Carry (200m)
- 7.Sandbag Lunges (100m)
- 8.Wall Balls (75-100 reps)

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

  if (trainingContext.structuredExerciseStats && Object.keys(trainingContext.structuredExerciseStats).length > 0) {
    contextSection += `\n\nStructured Exercise Performance:`;
    for (const [exercise, stats] of Object.entries(trainingContext.structuredExerciseStats)) {
      let line = `\n- ${exercise}: trained ${stats.count}x`;
      if (stats.maxWeight) line += `, max weight: ${stats.maxWeight}`;
      if (stats.maxDistance) line += `, max distance: ${stats.maxDistance}`;
      if (stats.bestTime) line += `, best time: ${stats.bestTime}min`;
      if (stats.avgReps) line += `, avg reps: ${stats.avgReps}`;
      contextSection += line;
    }
  }

  if (trainingContext.recentWorkouts.length > 0) {
    contextSection += `\n\nRecent Workouts (last 7):`;
    for (const workout of trainingContext.recentWorkouts.slice(0, 7)) {
      let line = `\n- ${workout.date}: ${workout.focus || 'General'} - ${workout.mainWorkout || 'No details'} (${workout.status})`;
      if (workout.exerciseDetails && workout.exerciseDetails.length > 0) {
        type ExDetail = { name: string; setNumber?: number | null; reps?: number | null; weight?: number | null; distance?: number | null; time?: number | null };
        const grouped = new Map<string, ExDetail[]>();
        for (const ex of workout.exerciseDetails) {
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
          details.push(parts.join(' '));
        });
        line += ` [${details.join(', ')}]`;
      }
      contextSection += line;
    }
  }

  contextSection += `\n\n--- END TRAINING DATA ---\n\nUse this data to provide personalized coaching. Reference specific workouts and patterns when relevant.`;

  return BASE_SYSTEM_PROMPT + contextSection;
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

const SUGGESTIONS_PROMPT = `You are an expert Hyrox training coach analyzing an athlete's training plan. Based on their past workout history and upcoming scheduled workouts, provide specific, actionable suggestions to optimize their training for Hyrox performance.

Hyrox stations: SkiErg (1000m), Sled Push (50m), Sled Pull (50m), Burpee Broad Jumps (80m), Rowing (1000m), Farmers Carry (200m), Sandbag Lunges (100m), Wall Balls (75-100 reps), plus 8x 1km runs betwen each station.

When making suggestions:
- Identify training gaps (stations not practiced recently)
- Consider recovery and training load balance
- Suggest intensity adjustments based on recent performance
- Recommend exercise substitutions or additions
- Focus on race-specific preparation

Return ONLY valid JSON array with no markdown formatting. Each suggestion should have:
- workoutId: the ID of the upcoming workout
- workoutDate: the scheduled date
- workoutFocus: the original focus of the workout
- targetField: which part to modify - "mainWorkout", "accessory", or "notes"
- action: "replace" to replace the field entirely, or "append" to add to existing content
- recommendation: the specific text to add or replace (just the workout content, not explanation)
- rationale: why this change helps Hyrox performance (1 sentence)
- priority: "high", "medium", or "low"

IMPORTANT RULES:
1. Use "append" for notes to preserve existing workout instructions
2. Use "replace" for mainWorkout only when suggesting a completely different exercise
3. Use "append" for accessory to add extra work without removing existing accessory
4. The recommendation field should contain ONLY the workout text to insert, not explanations
5. Prioritize suggestions for workouts happening soonest (today, tomorrow, this week)

Limit to 1 suggestion per workout, max 5 suggestions total. Only suggest changes where meaningful improvements can be made.`;

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
      prompt += `ID: ${workout.id}, Date: ${workout.date}, Focus: ${workout.focus}, Main: ${workout.mainWorkout}${workout.accessory ? `, Accessory: ${workout.accessory}` : ''}\n`;
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
    // Parse JSON from response, handling potential markdown code blocks
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
