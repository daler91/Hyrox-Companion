import { z } from "zod";
import { logger } from "../logger";
import { SUGGESTIONS_PROMPT } from "../prompts";
import { getAiClient, GEMINI_SUGGESTIONS_MODEL, retryWithBackoff, truncate } from "./client";
import { ThinkingLevel } from "@google/genai";
import { sanitizeHtml } from "../utils/sanitize";
import type { TrainingContext } from "./types";


export interface UpcomingWorkout {
  id: string;
  date: string;
  focus: string;
  mainWorkout: string;
  accessory?: string;
  notes?: string;
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

export function parseAndValidateSuggestions(text: string): WorkoutSuggestion[] {
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
      const item = result.data;
      validated.push({
        ...item,
        recommendation: sanitizeHtml(item.recommendation),
        rationale: sanitizeHtml(item.rationale),
        workoutFocus: sanitizeHtml(item.workoutFocus)
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
    lines.push(`PLAN PHASE: Week ${p.currentWeek} of ${p.totalWeeks} (${p.phaseLabel.toUpperCase()} phase, ${p.progressPct}% complete). Coach according to ${p.phaseLabel} phase guidelines.`);
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

function buildSuggestionsPrompt(
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[],
  planGoal?: string,
  coachingMaterials?: string,
): string {
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

  // Add coaching analysis if available
  if (trainingContext.coachingInsights) {
    sections.push(formatCoachingAnalysis(trainingContext.coachingInsights, planGoal));
  }

  sections.push(
    `--- UPCOMING WORKOUTS ---`,
    upcomingWorkouts.map(formatUpcomingWorkout).join("\n"),
    ...(coachingMaterials ? [coachingMaterials] : []),
    `Analyze the coaching analysis and athlete data above. Make modifications that actively improve this athlete's training. Return [] ONLY if the plan genuinely needs zero adjustments.`,
  );

  return sections.filter(Boolean).join("\n");
}

export async function generateWorkoutSuggestions(
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[],
  planGoal?: string,
  coachingMaterials?: string,
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

    const text = response.text || "[]";

    return parseAndValidateSuggestions(text);
  } catch (error) {
    logger.error({ err: error }, "[gemini] suggestions error:");
    return [];
  }
}
