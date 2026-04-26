import type { UpdatePlanDay } from "@shared/schema";
import type { Logger } from "pino";

import { db } from "../db";
import { generateWorkoutSuggestions, type UpcomingWorkout } from "../gemini/index";
import { logger as defaultLogger } from "../logger";
import { buildWorkoutSearchText } from "../prompts/exerciseSetFormatter";
import { storage } from "../storage";
import { buildAIContext, extractCoachingMaterialsText } from "./aiContextService";
import { sanitizeRagInfo } from "./ragRetrieval";
import {
  applyStructuredPlanDaySuggestionRows,
  parseStructuredPlanDaySuggestionRows,
} from "./structuredPlanDaySuggestion";

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

export interface ApplyTimelineSuggestionInput {
  workoutId: string;
  targetField: TimelineSuggestion["targetField"];
  action: TimelineSuggestion["action"];
  recommendation: string;
  rationale?: string | null;
  aiSource?: "rag" | "legacy" | "none" | null;
}

export interface ApplyTimelineSuggestionResult {
  applied: true;
  structured: boolean;
}

function getPlanDayFieldValue(
  day: { mainWorkout: string; accessory?: string | null; notes?: string | null },
  targetField: TimelineSuggestion["targetField"],
): string {
  if (targetField === "mainWorkout") return day.mainWorkout;
  if (targetField === "accessory") return day.accessory || "";
  return day.notes || "";
}

function buildTextUpdateValue(
  day: { mainWorkout: string; accessory?: string | null; notes?: string | null },
  input: ApplyTimelineSuggestionInput,
): string {
  if (input.action !== "append") return input.recommendation;
  const existing = getPlanDayFieldValue(day, input.targetField).trim();
  return existing
    ? `${existing}\n\nAI suggestion: ${input.recommendation}`
    : `AI suggestion: ${input.recommendation}`;
}

function normalizeAiSource(source: ApplyTimelineSuggestionInput["aiSource"]): "rag" | "legacy" | null {
  return source === "rag" || source === "legacy" ? source : null;
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
  const [plannedDays, user] = await Promise.all([
    storage.timeline.getUpcomingPlannedDays(userId, 5),
    storage.users.getUser(userId),
  ]);
  const upcomingWorkouts: UpcomingWorkout[] = plannedDays.map((d) => ({
    id: d.planDayId,
    date: d.date,
    focus: d.focus,
    mainWorkout: d.mainWorkout,
    accessory: d.accessory || undefined,
    notes: d.notes || undefined,
    ...(d.exerciseSets && d.exerciseSets.length > 0
      ? {
          exerciseDetails: d.exerciseSets.map(es => ({
            exerciseName: es.exerciseName,
            customLabel: es.customLabel,
            category: es.category,
            setNumber: es.setNumber,
            reps: es.reps,
            weight: es.weight,
            distance: es.distance,
            time: es.time,
            notes: es.notes,
            sortOrder: es.sortOrder,
          })),
        }
      : {}),
  }));

  if (upcomingWorkouts.length === 0) {
    return { suggestions: [], message: "No upcoming planned workouts found" };
  }

  const suggestionQuery = upcomingWorkouts
    .map((w) => buildWorkoutSearchText(w, { weightUnit: user?.weightUnit || "kg" }))
    .join("; ");
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

export async function applyTimelineAiSuggestion(
  userId: string,
  input: ApplyTimelineSuggestionInput,
  log: Logger = defaultLogger,
): Promise<ApplyTimelineSuggestionResult | undefined> {
  const [day, user, existingExerciseSets] = await Promise.all([
    storage.plans.getPlanDay(input.workoutId, userId),
    storage.users.getUser(userId),
    storage.workouts.getExerciseSetsByPlanDay(input.workoutId, userId),
  ]);

  if (!day || existingExerciseSets === null) {
    return undefined;
  }

  const aiMetadata: UpdatePlanDay = {
    aiSource: normalizeAiSource(input.aiSource),
    aiRationale: input.rationale ? input.rationale.slice(0, 400) : null,
    aiNoteUpdatedAt: new Date(),
  };

  const shouldWriteStructuredRows = existingExerciseSets.length > 0 && input.targetField !== "notes";
  if (shouldWriteStructuredRows) {
    try {
      const structuredSetRows = await parseStructuredPlanDaySuggestionRows(
        input,
        user?.weightUnit || "kg",
        userId,
      );

      if (structuredSetRows.length > 0) {
        await db.transaction(async (tx) => {
          await applyStructuredPlanDaySuggestionRows(
            input.workoutId,
            input.action,
            structuredSetRows,
            tx,
          );
          await storage.plans.updatePlanDay(input.workoutId, aiMetadata, userId, tx);
        });
        return { applied: true, structured: true };
      }
    } catch (err) {
      log.warn(
        { err, workoutId: input.workoutId, targetField: input.targetField },
        "[timeline] Structured suggestion apply failed; falling back to text update",
      );
    }
  }

  const textUpdates: UpdatePlanDay = { ...aiMetadata };
  textUpdates[input.targetField] = buildTextUpdateValue(day, input);
  await storage.plans.updatePlanDay(input.workoutId, textUpdates, userId);

  return { applied: true, structured: false };
}
