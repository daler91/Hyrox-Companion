import { ThinkingLevel } from "@google/genai";
import { z } from "zod";

import { logger } from "../logger";
import { SUGGESTIONS_PROMPT } from "../prompts";
import { GEMINI_SUGGESTIONS_MODEL, getAiClient, retryWithBackoff, trackUsageFromResponse } from "./client";
import type { TrainingContext } from "./types";


export interface UpcomingWorkout {
  id: string;
  date: string;
  focus: string;
  mainWorkout: string;
  accessory?: string;
  notes?: string;
}

export type { WorkoutSuggestion } from "@shared/schema";
import type { WorkoutSuggestion } from "@shared/schema";

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
    logger.error({ err: parseErr, responseLength: text.length }, "[gemini] suggestions JSON.parse failed.");
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
        workoutFocus: item.workoutFocus.replaceAll("&", "and")
      });
    } else {
      logger.warn({ issues: result.error.issues, item: JSON.stringify(item).slice(0, 200) }, "[gemini] Dropping invalid suggestion:");
    }
  }
  return validated;
}

function formatExerciseFrequency(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown);
  if (entries.length === 0) return "";
  return "\nExercise frequency:\n" + entries.map(([exercise, count]) => `- ${exercise}: ${count}x`).join("\n") + "\n";
}

function formatExerciseStatLine(exercise: string, stats: { count: number; maxWeight?: number; maxDistance?: number; bestTime?: number; avgReps?: number }): string {
  const parts = [`- ${exercise}: trained ${stats.count}x`];
  if (stats.maxWeight) parts.push(`max weight: ${stats.maxWeight}`);
  if (stats.maxDistance) parts.push(`max distance: ${stats.maxDistance}m`);
  if (stats.bestTime) parts.push(`best time: ${stats.bestTime}min`);
  if (stats.avgReps) parts.push(`avg reps: ${stats.avgReps}`);
  return parts.join(", ");
}

function formatPerformanceStats(stats: TrainingContext["structuredExerciseStats"]): string {
  if (!stats || Object.keys(stats).length === 0) return "";
  return "\nExercise performance stats:\n" + Object.entries(stats).map(([ex, s]) => formatExerciseStatLine(ex, s)).join("\n") + "\n";
}

function formatRecentWorkout(workout: TrainingContext["recentWorkouts"][0]): string {
  let line = `- ${workout.date}: ${workout.focus} - ${workout.mainWorkout}`;
  const meta: string[] = [];
  if (workout.rpe != null) meta.push(`RPE: ${workout.rpe}`);
  if (workout.duration != null) meta.push(`Duration: ${workout.duration}min`);
  if (meta.length > 0) line += ` (${meta.join(", ")})`;
  return line;
}

function formatRecentWorkouts(workouts: TrainingContext["recentWorkouts"]): string {
  if (workouts.length === 0) return "";
  return "\nRecent completed workouts:\n" + workouts.slice(0, 10).map(formatRecentWorkout).join("\n") + "\n";
}

function formatUpcomingWorkout(workout: UpcomingWorkout): string {
  let line = `ID: ${workout.id}, Date: ${workout.date}, Focus: ${workout.focus}, Main: ${workout.mainWorkout}`;
  if (workout.accessory) line += `, Accessory: ${workout.accessory}`;
  if (workout.notes) line += `, Notes: ${workout.notes}`;
  return line;
}

function formatRpeTrend(insights: NonNullable<TrainingContext["coachingInsights"]>): string {
  if (insights.rpeTrend === "insufficient_data") {
    return `RPE TREND: Insufficient data (fewer than 3 workouts with RPE logged).`;
  }

  let rpeLine = `RPE TREND: ${insights.rpeTrend.toUpperCase()}`;
  if (insights.avgRpeLast3 != null) rpeLine += ` (avg ${insights.avgRpeLast3} last 3 workouts`;
  if (insights.avgRpePrior3 != null) rpeLine += ` vs ${insights.avgRpePrior3} prior 3`;
  if (insights.avgRpeLast3 != null) rpeLine += `)`;
  if (insights.fatigueFlag) rpeLine += `. FATIGUE FLAG ACTIVE — athlete needs volume reduction.`;
  if (insights.undertrainingFlag) rpeLine += `. UNDERTRAINING FLAG ACTIVE — athlete needs more intensity.`;
  return rpeLine;
}

function formatStationGapEntry(g: NonNullable<TrainingContext["coachingInsights"]>["stationGaps"][0], severity: "critical" | "high"): string {
  if (severity === "critical") {
    const label = g.daysSinceLastTrained === null ? "NEVER TRAINED" : `${g.daysSinceLastTrained} days`;
    return `${g.station} (${label} — CRITICAL)`;
  }
  return `${g.station} (${g.daysSinceLastTrained} days — needs attention)`;
}

function formatStationGaps(stationGaps: NonNullable<TrainingContext["coachingInsights"]>["stationGaps"]): string {
  const criticalGaps = stationGaps.filter(g => g.daysSinceLastTrained === null || g.daysSinceLastTrained >= 14);
  const highGaps = stationGaps.filter(g => g.daysSinceLastTrained != null && g.daysSinceLastTrained >= 10 && g.daysSinceLastTrained < 14);
  const okCount = stationGaps.filter(g => g.daysSinceLastTrained != null && g.daysSinceLastTrained < 10).length;

  const gapParts: string[] = [];
  for (const g of criticalGaps) gapParts.push(formatStationGapEntry(g, "critical"));
  for (const g of highGaps) gapParts.push(formatStationGapEntry(g, "high"));

  if (okCount > 0 && gapParts.length > 0) {
    gapParts.push(`${okCount} exercises OK (<10 days)`);
  } else if (gapParts.length === 0) {
    gapParts.push(`All exercises trained within 10 days — good coverage.`);
  }

  return `EXERCISE GAPS: ${gapParts.join(", ")}`;
}

function formatCoachingAnalysis(insights: NonNullable<TrainingContext["coachingInsights"]>, planGoal?: string): string {
  const lines: string[] = [
    `--- COACHING ANALYSIS ---`,
    formatRpeTrend(insights),
    formatStationGaps(insights.stationGaps),
  ];

  if (insights.planPhase) {
    const p = insights.planPhase;
    const remaining = p.remainingPhases.length > 0
      ? ` Remaining phases: ${p.remainingPhases.map(phase => phase.toUpperCase()).join(" → ")}.`
      : "";
    lines.push(`PLAN PHASE: Week ${p.currentWeek} of ${p.totalWeeks} (${p.phaseLabel.toUpperCase()} phase, ${p.progressPct}% complete). Coach according to ${p.phaseLabel} phase guidelines.${remaining}`);
  }

  if (insights.progressionFlags.length > 0) {
    const flagLines = insights.progressionFlags.map(f =>
      `${f.exercise}: ${f.flag.toUpperCase()} — ${f.detail}`
    );
    lines.push(`PROGRESSION:\n${flagLines.join("\n")}`);
  }

  if (insights.weeklyVolume) {
    const v = insights.weeklyVolume;
    lines.push(`WEEKLY VOLUME: ${v.thisWeekCompleted}/${v.goal} goal this week (last week: ${v.lastWeekCompleted}/${v.goal}). Trend: ${v.trend}.`);
  }

  if (planGoal) {
    lines.push(`ATHLETE'S GOAL: "${planGoal}"`);
  }

  lines.push(`--- END COACHING ANALYSIS ---`);
  return lines.join("\n");
}

/**
 * Assemble the shared athlete/plan data sections used by both the
 * modification and review-note prompts. Kept separate from the
 * trailing closing instruction so each flow can steer the model
 * toward its own output schema without conflicting guidance
 * (review-note prompt kept getting zero-suggestion hints before
 * this was split out).
 */
function buildPromptDataSections(
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[],
  planGoal?: string,
  coachingMaterials?: string,
): string[] {
  const header = [
    `--- ATHLETE'S TRAINING DATA ---`,
    ...(planGoal ? [`Athlete's goal: ${planGoal}`] : []),
    `Completion rate: ${trainingContext.completionRate}%`,
    `Current streak: ${trainingContext.currentStreak} days`,
    `Completed workouts: ${trainingContext.completedWorkouts}`,
    ...(trainingContext.weeklyGoal ? [`Weekly goal: ${trainingContext.weeklyGoal} workouts/week`] : []),
  ];

  const sections = [
    ...header,
    formatExerciseFrequency(trainingContext.exerciseBreakdown),
    formatPerformanceStats(trainingContext.structuredExerciseStats),
    formatRecentWorkouts(trainingContext.recentWorkouts),
  ];

  if (trainingContext.coachingInsights) {
    sections.push(formatCoachingAnalysis(trainingContext.coachingInsights, planGoal));
  }

  sections.push(
    `--- UPCOMING WORKOUTS ---`,
    upcomingWorkouts.map(formatUpcomingWorkout).join("\n"),
    ...(coachingMaterials ? [coachingMaterials] : []),
  );

  return sections;
}

export function buildSuggestionsPrompt(
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[],
  planGoal?: string,
  coachingMaterials?: string,
): string {
  const sections = buildPromptDataSections(
    trainingContext,
    upcomingWorkouts,
    planGoal,
    coachingMaterials,
  );
  sections.push(
    `Analyze the coaching analysis and athlete data above. Make modifications that actively improve this athlete's training. Return [] ONLY if the plan genuinely needs zero adjustments.`,
  );
  return sections.filter(Boolean).join("\n");
}

function buildReviewNotesPrompt(
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[],
  planGoal?: string,
  coachingMaterials?: string,
): string {
  const sections = buildPromptDataSections(
    trainingContext,
    upcomingWorkouts,
    planGoal,
    coachingMaterials,
  );
  sections.push(
    `Write exactly one review note per upcoming workout ID listed above. Do NOT propose a modification, do NOT return suggestions, and do NOT return an empty array. Return a JSON array of objects with exactly two fields: { "workoutId": string, "note": string }.`,
  );
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

Your job is to write one note per upcoming workout ID, explaining in 1-2 sentences why the current plan still fits them given their data. Reference at least one specific signal you were given (RPE trend, plan phase, station gaps, recent workouts, plan goal, or coaching materials). Do not prescribe a new workout — these are review notes only.

Return a JSON array of objects: [{ "workoutId": string, "note": string }, ...]. One entry per upcoming workout ID supplied. Keep each note under 280 characters. Do not include any other fields.`;

export function parseAndValidateReviewNotes(text: string): ReviewNote[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (parseErr) {
    logger.error({ err: parseErr, responseLength: text.length }, "[gemini] review-notes JSON.parse failed.");
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
): Promise<ReviewNote[]> {
  try {
    if (upcomingWorkouts.length === 0) return [];

    const prompt = buildReviewNotesPrompt(
      trainingContext,
      upcomingWorkouts,
      planGoal,
      coachingMaterials,
    );

    const response = await retryWithBackoff(
      () =>
        getAiClient().models.generateContent({
          model: GEMINI_SUGGESTIONS_MODEL,
          config: {
            systemInstruction: REVIEW_NOTES_SYSTEM_PROMPT,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      "review-notes",
    );

    if (userId) trackUsageFromResponse(userId, GEMINI_SUGGESTIONS_MODEL, "review-notes", response);

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
): Promise<WorkoutSuggestion[]> {
  try {
    if (upcomingWorkouts.length === 0) {
      return [];
    }

    const prompt = buildSuggestionsPrompt(trainingContext, upcomingWorkouts, planGoal, coachingMaterials);

    const response = await retryWithBackoff(
      () =>
        getAiClient().models.generateContent({
          model: GEMINI_SUGGESTIONS_MODEL,
          config: {
            systemInstruction: SUGGESTIONS_PROMPT,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      "suggestions",
    );

    if (userId) trackUsageFromResponse(userId, GEMINI_SUGGESTIONS_MODEL, "suggestions", response);

    const text = response.text || "[]";

    return parseAndValidateSuggestions(text);
  } catch (error) {
    logger.error({ err: error }, "[gemini] suggestions error:");
    return [];
  }
}
