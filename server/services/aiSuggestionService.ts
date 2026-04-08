import type { Logger } from "pino";

import { generateWorkoutSuggestions, type UpcomingWorkout } from "../gemini/index";
import { storage } from "../storage";
import { buildAIContext, extractCoachingMaterialsText } from "./aiContextService";
import { sanitizeRagInfo } from "./ragRetrieval";

export interface TimelineSuggestion {
  workoutId: string;
  date: string;
  focus: string;
  targetField: "notes" | "mainWorkout" | "accessory";
  action: "replace" | "append";
  recommendation: string;
  rationale: string;
  priority: "low" | "medium" | "high";
}

export interface TimelineSuggestionsResult {
  suggestions: TimelineSuggestion[];
  ragInfo?: ReturnType<typeof sanitizeRagInfo>;
  message?: string;
}

/**
 * Fetches the user's upcoming planned workouts, builds RAG context, asks
 * Gemini for coaching suggestions, and shapes them for the client.
 *
 * Extracted from routes/ai.ts (CODEBASE_AUDIT.md §1) so the route handler
 * stays thin and the orchestration — multiple storage calls + context
 * build + AI call + response shaping — lives next to other services.
 */
export async function generateTimelineAiSuggestions(
  userId: string,
  log: Logger,
): Promise<TimelineSuggestionsResult> {
  const plannedDays = await storage.timeline.getUpcomingPlannedDays(userId, 5);
  const upcomingWorkouts: UpcomingWorkout[] = plannedDays.map((d) => ({
    id: d.planDayId,
    date: d.date,
    focus: d.focus,
    mainWorkout: d.mainWorkout,
    accessory: d.accessory || undefined,
    notes: d.notes || undefined,
  }));

  if (upcomingWorkouts.length === 0) {
    return { suggestions: [], message: "No upcoming planned workouts found" };
  }

  const suggestionQuery = upcomingWorkouts.map((w) => `${w.focus} ${w.mainWorkout}`).join("; ");
  const aiContext = await buildAIContext(userId, suggestionQuery, log);
  const coachingMaterials = extractCoachingMaterialsText(aiContext);

  const rawSuggestions = await generateWorkoutSuggestions(
    aiContext.trainingContext,
    upcomingWorkouts,
    undefined,
    coachingMaterials,
    userId,
  );

  const workoutMap = new Map(upcomingWorkouts.map((w) => [w.id, w]));
  const suggestions = rawSuggestions.reduce<TimelineSuggestion[]>((acc, s) => {
    const workout = workoutMap.get(s.workoutId);
    const mapped: TimelineSuggestion = {
      workoutId: s.workoutId,
      date: workout?.date || s.workoutDate || "",
      focus: workout?.focus || s.workoutFocus || "",
      targetField: s.targetField || "notes",
      action: s.action || "append",
      recommendation: s.recommendation,
      rationale: s.rationale,
      priority: s.priority,
    };
    if (mapped.date && mapped.focus && mapped.recommendation) {
      acc.push(mapped);
    }
    return acc;
  }, []);

  return { suggestions, ragInfo: sanitizeRagInfo(aiContext.ragInfo) };
}
