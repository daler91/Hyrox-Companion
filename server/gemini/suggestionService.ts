import type { CoachNoteInputs, WorkoutSuggestion } from "@shared/schema";
import { z } from "zod";

import { generateJsonText } from "../ai/providers";
import { logger } from "../logger";
import { SUGGESTIONS_PROMPT } from "../prompts";
import { formatCoachingAnalysis } from "../prompts/coachingAnalysis";
import { relativeDayLabel } from "../prompts/coachingContext";
import {
  formatExerciseSetsForPrompt,
  type PromptExerciseSet,
} from "../prompts/exerciseSetFormatter";
import { buildNutritionSection } from "../prompts/nutritionContext";
import { sanitizeUserInput } from "../utils/sanitize";
import type { TrainingContext } from "./types";

export interface SuggestionPromptOptions {
  promptPrefix?: string;
  promptSuffix?: string;
  systemInstructionAppendix?: string;
}

export interface UpcomingWorkout {
  id: string;
  date: string;
  focus: string;
  mainWorkout: string;
  accessory?: string;
  notes?: string;
  exerciseDetails?: PromptExerciseSet[];
  aiSource?: "rag" | "legacy" | "review" | "load_governor" | null;
  aiRationale?: string | null;
  aiNoteUpdatedAt?: string | Date | null;
  aiInputsUsed?: CoachNoteInputs | null;
}

export type { WorkoutSuggestion };

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

export function parseAndValidateSuggestions(text: string): WorkoutSuggestion[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (parseErr) {
    logger.error(
      { err: parseErr, responseLength: text.length },
      "[gemini] suggestions JSON.parse failed.",
    );
    return [];
  }

  const rawArray = Array.isArray(raw) ? raw : [];
  const validated: WorkoutSuggestion[] = [];
  for (const item of rawArray) {
    const result = workoutSuggestionSchema.safeParse(item);
    if (result.success) {
      const item = result.data;
      // Swap `&` for "and" so "A & B" renders as "A and B". We intentionally
      // do NOT HTML-encode — these strings are rendered as React text (e.g.
      // CoachTakePanel's `{rationale}`), which already escapes HTML safely.
      // Pre-encoding here was leaking `&#39;` into the UI as literal chars.
      validated.push({
        ...item,
        recommendation: item.recommendation.replaceAll("&", "and"),
        rationale: item.rationale.replaceAll("&", "and"),
        workoutFocus: item.workoutFocus.replaceAll("&", "and"),
      });
    } else {
      logger.warn(
        { issues: result.error.issues, item: JSON.stringify(item).slice(0, 200) },
        "[gemini] Dropping invalid suggestion:",
      );
    }
  }
  return validated;
}

function formatExerciseFrequency(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown);
  if (entries.length === 0) return "";
  return (
    "\nExercise frequency:\n" +
    entries.map(([exercise, count]) => `- ${exercise}: ${count}x`).join("\n") +
    "\n"
  );
}

function formatExerciseStatLine(
  exercise: string,
  stats: {
    count: number;
    maxWeight?: number;
    maxDistance?: number;
    bestTime?: number;
    avgReps?: number;
  },
): string {
  const parts = [`- ${exercise}: trained ${stats.count}x`];
  if (stats.maxWeight) parts.push(`max weight: ${stats.maxWeight}`);
  if (stats.maxDistance) parts.push(`max distance: ${stats.maxDistance}m`);
  if (stats.bestTime) parts.push(`best time: ${stats.bestTime}min`);
  if (stats.avgReps) parts.push(`avg reps: ${stats.avgReps}`);
  return parts.join(", ");
}

function formatPerformanceStats(stats: TrainingContext["structuredExerciseStats"]): string {
  if (!stats || Object.keys(stats).length === 0) return "";
  return (
    "\nExercise performance stats:\n" +
    Object.entries(stats)
      .map(([ex, s]) => formatExerciseStatLine(ex, s))
      .join("\n") +
    "\n"
  );
}

function formatRecentWorkout(
  workout: TrainingContext["recentWorkouts"][0],
  trainingContext: TrainingContext,
): string {
  const exerciseSummary = formatExerciseSetsForPrompt(workout.exerciseDetails, {
    weightUnit: trainingContext.weightUnit,
    distanceUnit: trainingContext.distanceUnit,
  });
  const workoutDetails = exerciseSummary ? `Exercises: ${exerciseSummary}` : sanitizeUserInput(workout.mainWorkout);
  let line = `- ${workout.date}${relativeDayLabel(workout.date, trainingContext.currentDate)}: ${sanitizeUserInput(workout.focus)} - ${workoutDetails}`;
  const meta: string[] = [];
  if (workout.rpe != null) meta.push(`RPE: ${workout.rpe}`);
  if (workout.duration != null) meta.push(`Duration: ${workout.duration}min`);
  if (meta.length > 0) line += ` (${meta.join(", ")})`;
  if (workout.athleteNote?.trim()) line += ` | Athlete note: ${sanitizeUserInput(workout.athleteNote.trim())}`;
  return line;
}

function formatRecentWorkouts(trainingContext: TrainingContext): string {
  const workouts = trainingContext.recentWorkouts;
  if (workouts.length === 0) return "";
  return (
    "\nRecent completed workouts:\n" +
    workouts
      .slice(0, 10)
      .map((workout) => formatRecentWorkout(workout, trainingContext))
      .join("\n") +
    "\n"
  );
}

function formatModificationContext(
  label: string,
  modification: NonNullable<UpcomingWorkout["aiInputsUsed"]>["lastModification"],
): string | undefined {
  if (!modification) return undefined;
  const details = [`kind=${modification.kind}`];
  if (typeof modification.completedWorkoutCount === "number") {
    details.push(`completedWorkoutsAtEdit=${modification.completedWorkoutCount}`);
  }
  if (modification.rpeTrend) details.push(`rpeTrendAtEdit=${modification.rpeTrend}`);
  if (typeof modification.fatigueFlag === "boolean") {
    details.push(`fatigueFlagAtEdit=${modification.fatigueFlag}`);
  }
  if (modification.reason) details.push(`reason=${modification.reason}`);
  return `${label}: ${details.join("; ")}`;
}

function formatPriorAiContext(workout: UpcomingWorkout): string {
  const prior: string[] = [];
  if (workout.aiRationale?.trim()) {
    prior.push(`Prior AI review: ${workout.aiRationale.trim()}`);
  }

  const lastModificationContext = formatModificationContext(
    "Last AI modification",
    workout.aiInputsUsed?.lastModification,
  );
  if (lastModificationContext) prior.push(lastModificationContext);

  const lastFatigueReductionContext = formatModificationContext(
    "Last fatigue reduction",
    workout.aiInputsUsed?.lastFatigueReduction,
  );
  if (
    lastFatigueReductionContext &&
    lastFatigueReductionContext !==
      lastModificationContext?.replace("Last AI modification", "Last fatigue reduction")
  ) {
    prior.push(lastFatigueReductionContext);
  }

  return prior.length > 0 ? `, ${prior.join(", ")}` : "";
}

function formatUpcomingWorkout(workout: UpcomingWorkout, trainingContext: TrainingContext): string {
  const exerciseSummary = formatExerciseSetsForPrompt(workout.exerciseDetails, {
    weightUnit: trainingContext.weightUnit,
    distanceUnit: trainingContext.distanceUnit,
  });
  const priorAiContext = formatPriorAiContext(workout);
  const dateLabel = `${workout.date}${relativeDayLabel(workout.date, trainingContext.currentDate)}`;
  if (exerciseSummary) {
    return `ID: ${workout.id}, Date: ${dateLabel}, Focus: ${sanitizeUserInput(workout.focus)}, Exercises: ${exerciseSummary}${priorAiContext}`;
  }
  let line = `ID: ${workout.id}, Date: ${dateLabel}, Focus: ${sanitizeUserInput(workout.focus)}, Main: ${sanitizeUserInput(workout.mainWorkout)}`;
  if (workout.accessory) line += `, Accessory: ${sanitizeUserInput(workout.accessory)}`;
  if (workout.notes) line += `, Notes: ${sanitizeUserInput(workout.notes)}`;
  line += priorAiContext;
  return line;
}

/**
 * Assemble the shared athlete/plan data sections used by both the
 * modification and review-note prompts. Kept separate from the
 * trailing closing instruction so each flow can steer the model
 * toward its own output schema without conflicting guidance
 * (review-note prompt kept getting zero-suggestion hints before
 * this was split out).
 */
export function buildPromptDataSections(
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[],
  planGoal?: string,
  coachingMaterials?: string,
): string[] {
  const header = [
    `--- ATHLETE'S TRAINING DATA ---`,
    ...(trainingContext.currentDate
      ? [`Today's date: ${trainingContext.currentDate} (use this as "today"; workout dates below are annotated relative to it)`]
      : []),
    ...(planGoal ? [`Athlete's goal: ${sanitizeUserInput(planGoal)}`] : []),
    `Completion rate: ${trainingContext.completionRate}%`,
    `Current streak: ${trainingContext.currentStreak} days`,
    `Completed workouts: ${trainingContext.completedWorkouts}`,
    ...(trainingContext.weeklyGoal
      ? [`Weekly goal: ${trainingContext.weeklyGoal} workouts/week`]
      : []),
  ];

  const sections = [
    ...header,
    formatExerciseFrequency(trainingContext.exerciseBreakdown),
    formatPerformanceStats(trainingContext.structuredExerciseStats),
    formatRecentWorkouts(trainingContext),
  ];

  if (trainingContext.coachingInsights) {
    sections.push(formatCoachingAnalysis(trainingContext.coachingInsights, planGoal));
  }

  const nutritionSection = buildNutritionSection(trainingContext);
  if (nutritionSection) sections.push(nutritionSection);

  sections.push(
    `--- UPCOMING WORKOUTS ---`,
    upcomingWorkouts.map((workout) => formatUpcomingWorkout(workout, trainingContext)).join("\n"),
    ...(coachingMaterials ? [coachingMaterials] : []),
  );

  return sections;
}

export function buildSuggestionsPrompt(
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[],
  planGoal?: string,
  coachingMaterials?: string,
  promptOptions?: SuggestionPromptOptions,
): string {
  const sections = buildPromptDataSections(
    trainingContext,
    upcomingWorkouts,
    planGoal,
    coachingMaterials,
  );
  sections.push(
    `Analyze the coaching analysis and athlete data above. Evaluate each future workout as currently written, including any prior AI review or modification context. Make modifications that actively improve this athlete's training. Return [] when the current plan already fits the athlete, including when a workout was already reduced for the same fatigue episode and no new completed workouts change the evidence.`,
    ...(promptOptions?.promptSuffix ? [promptOptions.promptSuffix] : []),
  );
  if (promptOptions?.promptPrefix) sections.unshift(promptOptions.promptPrefix);
  return sections.filter(Boolean).join("\n");
}

function buildReviewNotesPrompt(
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[],
  planGoal?: string,
  coachingMaterials?: string,
  promptOptions?: SuggestionPromptOptions,
): string {
  const sections = buildPromptDataSections(
    trainingContext,
    upcomingWorkouts,
    planGoal,
    coachingMaterials,
  );
  sections.push(
    `Write exactly one review note per upcoming workout ID listed above. Do NOT propose a modification, do NOT return suggestions, and do NOT return an empty array. Return a JSON array of objects with exactly two fields: { "workoutId": string, "note": string }.`,
    ...(promptOptions?.promptSuffix ? [promptOptions.promptSuffix] : []),
  );
  if (promptOptions?.promptPrefix) sections.unshift(promptOptions.promptPrefix);
  return sections.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Review notes — "why the coach left this day alone"
// ---------------------------------------------------------------------------

export const reviewNoteSchema = z.object({
  workoutId: z.string(),
  note: z.string(),
});

export type ReviewNote = z.infer<typeof reviewNoteSchema>;

const REVIEW_NOTES_SYSTEM_PROMPT = `You are an elite functional fitness coach with deep knowledge of hyrox-style racing, running, and strength training. Write short reassurance notes to the athlete for upcoming workouts you reviewed but decided to leave as-is.

Your job is to write one note per upcoming workout ID, explaining in 1-2 sentences why the current plan still fits them given their data. Reference at least one specific signal you were given (RPE trend, plan phase, station gaps, training state, load governor / Form / monotony, race readiness, recent personal records, plan compliance, coverage gaps, recent workouts, plan goal, or coaching materials). Do not prescribe a new workout — these are review notes only.

Return a JSON array of objects: [{ "workoutId": string, "note": string }, ...]. One entry per upcoming workout ID supplied. Keep each note under 280 characters. Do not include any other fields.`;

export function parseAndValidateReviewNotes(text: string): ReviewNote[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (parseErr) {
    logger.error(
      { err: parseErr, responseLength: text.length },
      "[gemini] review-notes JSON.parse failed.",
    );
    return [];
  }
  const rawArray = Array.isArray(raw) ? raw : [];
  const validated: ReviewNote[] = [];
  for (const item of rawArray) {
    const result = reviewNoteSchema.safeParse(item);
    if (result.success) {
      const note = result.data;
      validated.push({
        workoutId: note.workoutId,
        // Plain text — rendered via React, no HTML encoding needed.
        note: note.note.replaceAll("&", "and").slice(0, 400),
      });
    } else {
      logger.warn(
        { issues: result.error.issues, item: JSON.stringify(item).slice(0, 200) },
        "[gemini] Dropping invalid review note:",
      );
    }
  }
  return validated;
}

export async function generateReviewNotes(
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[],
  planGoal?: string,
  coachingMaterials?: string,
  userId?: string,
  promptOptions?: SuggestionPromptOptions,
): Promise<ReviewNote[]> {
  try {
    if (upcomingWorkouts.length === 0) return [];

    const prompt = buildReviewNotesPrompt(
      trainingContext,
      upcomingWorkouts,
      planGoal,
      coachingMaterials,
      promptOptions,
    );

    const response = await generateJsonText({
      systemInstruction: [REVIEW_NOTES_SYSTEM_PROMPT, promptOptions?.systemInstructionAppendix]
        .filter(Boolean)
        .join("\n\n"),
      messages: [{ role: "user", content: prompt }],
      modelRole: "reasoning",
      label: "review-notes",
      feature: "review-notes",
      userId,
    });

    return parseAndValidateReviewNotes(response.text || "[]");
  } catch (error) {
    logger.error({ err: error }, "[gemini] review-notes error:");
    return [];
  }
}

export async function generateWorkoutSuggestions(
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[],
  planGoal?: string,
  coachingMaterials?: string,
  userId?: string,
  promptOptions?: SuggestionPromptOptions,
): Promise<WorkoutSuggestion[]> {
  try {
    if (upcomingWorkouts.length === 0) {
      return [];
    }

    const prompt = buildSuggestionsPrompt(
      trainingContext,
      upcomingWorkouts,
      planGoal,
      coachingMaterials,
      promptOptions,
    );

    const response = await generateJsonText({
      systemInstruction: [SUGGESTIONS_PROMPT, promptOptions?.systemInstructionAppendix]
        .filter(Boolean)
        .join("\n\n"),
      messages: [{ role: "user", content: prompt }],
      modelRole: "reasoning",
      label: "suggestions",
      feature: "suggestions",
      userId,
    });

    const text = response.text || "[]";

    return parseAndValidateSuggestions(text);
  } catch (error) {
    logger.error({ err: error }, "[gemini] suggestions error:");
    return [];
  }
}
