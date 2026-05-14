import type { UpdatePlanDay } from "@shared/schema";
import { normalizeWorkoutTextUnits } from "@shared/unitConversion";
import type { Logger } from "pino";

import { db } from "../db";
import { env } from "../env";
import { generateWorkoutSuggestions, type UpcomingWorkout } from "../gemini/index";
import { logger as defaultLogger } from "../logger";
import { buildWorkoutSearchText } from "../prompts/exerciseSetFormatter";
import { storage } from "../storage";
import { buildAIContext, extractCoachingMaterialsText } from "./aiContextService";
import { analyzeSafetySignals, applySafetyLayerToSuggestions, buildSafetyReviewNote } from "./aiSafety";
import { checkAiBudget } from "./aiUsageService";
import { sanitizeRagInfo } from "./ragRetrieval";
import {
  applyStructuredPlanDaySuggestionRows,
  parseStructuredPlanDaySuggestionRows,
} from "./structuredPlanDaySuggestion";
import { resolveTrainingStyle } from "./training_styles";

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

export interface RecommendationTraceMetadata {
  trainingStyleId: string;
  phase: string;
  strategyRuleVersion: string;
  promptBundleVersion: string;
  rationaleCodes?: string[];
}

export interface TimelineSuggestionsResult {
  suggestions: TimelineSuggestion[];
  ragInfo?: ReturnType<typeof sanitizeRagInfo>;
  message?: string;
  responseMetadata?: Record<string, RecommendationTraceMetadata>;
}

export interface ApplyTimelineSuggestionInput {
  workoutId: string;
  targetField: TimelineSuggestion["targetField"];
  action: TimelineSuggestion["action"];
  recommendation: string;
  rationale?: string | null;
  aiSource?: "rag" | "legacy" | "none" | null;
}

export type ApplyTimelineSuggestionFailureReason =
  | "ai_budget_exceeded"
  | "ai_disabled"
  | "structured_parse_failed";

export interface AppliedTimelineSuggestionResult {
  applied: true;
  structured: boolean;
}

export interface UnappliedTimelineSuggestionResult {
  applied: false;
  structured: false;
  reason: ApplyTimelineSuggestionFailureReason;
  message: string;
}

export type ApplyTimelineSuggestionResult =
  | AppliedTimelineSuggestionResult
  | UnappliedTimelineSuggestionResult;

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

const STRATEGY_RULE_VERSION = "training-decision-engine@v1";
const PROMPT_BUNDLE_VERSION = "timeline-suggestion@v1";

function resolveTrainingPhaseLabel(trainingContext: Awaited<ReturnType<typeof buildAIContext>>["trainingContext"]): string {
  return trainingContext.coachingInsights?.decisionTree?.currentPhase
    ?? trainingContext.coachingInsights?.planPhase?.phaseLabel
    ?? "unknown";
}

async function persistRecommendationTraceForSuggestions(
  userId: string,
  suggestions: TimelineSuggestion[],
  traceMetadata: RecommendationTraceMetadata,
  log: Logger,
): Promise<void> {
  await Promise.all(suggestions.map(async (suggestion) => {
    try {
      const day = await storage.plans.getPlanDay(suggestion.workoutId, userId);
      if (!day) return;
      await storage.plans.updatePlanDay(suggestion.workoutId, {
        aiInputsUsed: {
          ...day.aiInputsUsed,
          recommendationTrace: traceMetadata,
        },
      }, userId);
    } catch (err) {
      log.warn({ err, userId, workoutId: suggestion.workoutId }, "[timeline] Failed to persist recommendation trace metadata");
    }
  }));
}

function buildUnappliedStructuredResult(
  reason: ApplyTimelineSuggestionFailureReason,
): UnappliedTimelineSuggestionResult {
  const messageByReason: Record<ApplyTimelineSuggestionFailureReason, string> = {
    ai_budget_exceeded:
      "Applying that table-backed suggestion needs one more AI parse, but your daily AI limit has been reached. I left the workout unchanged.",
    ai_disabled:
      "Applying that table-backed suggestion needs one more AI parse, but AI features are temporarily disabled. I left the workout unchanged.",
    structured_parse_failed:
      "I couldn't convert that suggestion into exercise-table rows, so I left the table-backed workout unchanged.",
  };
  return {
    applied: false,
    structured: false,
    reason,
    message: messageByReason[reason],
  };
}

async function getStructuredApplyBlocker(
  userId: string,
  log: Logger,
): Promise<UnappliedTimelineSuggestionResult | null> {
  if (env.AI_FEATURES_ENABLED === "false") {
    return buildUnappliedStructuredResult("ai_disabled");
  }

  try {
    const budget = await checkAiBudget(userId);
    if (!budget.allowed) {
      return buildUnappliedStructuredResult("ai_budget_exceeded");
    }
  } catch (err) {
    log.warn({ err, userId }, "[timeline] AI budget check failed before structured apply; allowing parse");
  }

  return null;
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
    .map((w) => buildWorkoutSearchText(w, { weightUnit: user?.weightUnit || "kg", distanceUnit: user?.distanceUnit || "km" }))
    .join("; ");
  const aiContext = await buildAIContext(userId, suggestionQuery, log);
  const coachingMaterials = extractCoachingMaterialsText(aiContext);

  const resolvedStyle = resolveTrainingStyle(user?.trainingStyleId);
  const stylePromptContext = resolvedStyle.strategy.buildPromptContext(aiContext.trainingContext, upcomingWorkouts);

  const safetySignals = analyzeSafetySignals(aiContext.trainingContext, upcomingWorkouts);

  const rawSuggestions = await generateWorkoutSuggestions(
    aiContext.trainingContext,
    upcomingWorkouts,
    undefined,
    coachingMaterials,
    userId,
    stylePromptContext,
  );

  const safetyAdjustedSuggestions = applySafetyLayerToSuggestions(rawSuggestions, safetySignals);
  const workoutMap = new Map(upcomingWorkouts.map((w) => [w.id, w]));
  const suggestions = resolvedStyle.strategy.prescribeNext({ suggestions: safetyAdjustedSuggestions, trainingContext: aiContext.trainingContext }).reduce<TimelineSuggestion[]>((acc, s) => {
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

  const traceMetadata: RecommendationTraceMetadata = {
    trainingStyleId: resolvedStyle.trainingStyleId,
    phase: resolveTrainingPhaseLabel(aiContext.trainingContext),
    strategyRuleVersion: STRATEGY_RULE_VERSION,
    promptBundleVersion: PROMPT_BUNDLE_VERSION,
    rationaleCodes: aiContext.trainingContext.coachingInsights?.decisionTree?.rationaleCodes ?? undefined,
  };

  const forcedSafetyMessage = buildSafetyReviewNote(safetySignals);
  const surfacedSuggestions = forcedSafetyMessage && suggestions.length === 0
    ? [{
        workoutId: upcomingWorkouts[0].id,
        date: upcomingWorkouts[0].date,
        focus: upcomingWorkouts[0].focus,
        targetField: "notes" as const,
        action: "append" as const,
        recommendation: forcedSafetyMessage,
        rationale: "Safety escalation triggered from symptom/medication screening.",
        priority: "high" as const,
      }]
    : suggestions;

  await persistRecommendationTraceForSuggestions(userId, surfacedSuggestions, traceMetadata, log);

  return {
    suggestions: surfacedSuggestions,
    ragInfo: sanitizeRagInfo(aiContext.ragInfo),
    responseMetadata: Object.fromEntries(surfacedSuggestions.map((s) => [s.workoutId, traceMetadata])),
    ...(forcedSafetyMessage ? { message: forcedSafetyMessage } : {}),
  };
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

  const serverTrace: RecommendationTraceMetadata = day.aiInputsUsed?.recommendationTrace ?? {
    trainingStyleId: resolveTrainingStyle(user?.trainingStyleId).trainingStyleId,
    phase: day.aiInputsUsed?.planPhase ?? "unknown",
    strategyRuleVersion: STRATEGY_RULE_VERSION,
    promptBundleVersion: PROMPT_BUNDLE_VERSION,
  };

  const aiMetadata: UpdatePlanDay = {
    aiSource: normalizeAiSource(input.aiSource),
    aiRationale: input.rationale ? input.rationale.slice(0, 400) : null,
    aiNoteUpdatedAt: new Date(),
    aiInputsUsed: {
      ...day.aiInputsUsed,
      recommendationTrace: serverTrace,
    },
  };

  const shouldWriteStructuredRows = existingExerciseSets.length > 0 && input.targetField !== "notes";
  if (shouldWriteStructuredRows) {
    const structuredApplyBlocker = await getStructuredApplyBlocker(userId, log);
    if (structuredApplyBlocker) {
      return structuredApplyBlocker;
    }

    try {
      const structuredSetRows = await parseStructuredPlanDaySuggestionRows(
        input,
        { weightUnit: user?.weightUnit || "kg", distanceUnit: user?.distanceUnit || "km" },
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

      return buildUnappliedStructuredResult("structured_parse_failed");
    } catch (err) {
      log.warn(
        { err, workoutId: input.workoutId, targetField: input.targetField },
        "[timeline] Structured suggestion apply failed; leaving table-backed workout unchanged",
      );
      return buildUnappliedStructuredResult("structured_parse_failed");
    }
  }

  const textUpdates: UpdatePlanDay = { ...aiMetadata };
  const textUpdateValue = buildTextUpdateValue(day, input);
  textUpdates[input.targetField] = normalizeWorkoutTextUnits(
    textUpdateValue,
    { weightUnit: user?.weightUnit || "kg", distanceUnit: user?.distanceUnit || "km" },
  ) ?? textUpdateValue;
  await storage.plans.updatePlanDay(input.workoutId, textUpdates, userId);

  return { applied: true, structured: false };
}
