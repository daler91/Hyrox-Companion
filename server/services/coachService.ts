import { logger } from "../logger";
import { storage } from "../storage";
import { buildTrainingContext } from "./aiService";
import { generateWorkoutSuggestions, type UpcomingWorkout, type WorkoutSuggestion } from "../gemini/index";
import { toDateStr } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getExistingFieldValue(
  suggestion: WorkoutSuggestion,
  entry: UpcomingWorkout,
): string {
  if (suggestion.targetField === "mainWorkout") return entry.mainWorkout;
  if (suggestion.targetField === "accessory") return entry.accessory || "";
  return "";
}

function buildUpdateValue(
  suggestion: WorkoutSuggestion,
  entry: UpcomingWorkout,
): string {
  if (suggestion.action !== "append") return suggestion.recommendation;
  const existing = getExistingFieldValue(suggestion, entry);
  return existing
    ? `${existing}\n[AI Coach] ${suggestion.recommendation}`
    : `[AI Coach] ${suggestion.recommendation}`;
}

async function applySuggestion(
  suggestion: WorkoutSuggestion,
  upcomingWorkouts: UpcomingWorkout[],
  userId: string,
): Promise<boolean> {
  if (!suggestion.workoutId || !suggestion.recommendation) return false;
  const entry = upcomingWorkouts.find((w) => w.id === suggestion.workoutId);
  if (!entry) return false;

  try {
    const updateValue = buildUpdateValue(suggestion, entry);
    await storage.updatePlanDay(
      suggestion.workoutId,
      { [suggestion.targetField]: updateValue },
      userId,
    );
    return true;
  } catch (applyErr) {
    logger.warn(
      { err: applyErr, workoutId: suggestion.workoutId },
      "[coach] Failed to apply suggestion to plan day:",
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Auto-coach: fires after a workout is completed.
 * Reads the user's active plan goal + recent performance, then applies AI-suggested
 * adjustments directly to upcoming plan_days. Fire-and-forget — never throws.
 */
export async function triggerAutoCoach(userId: string): Promise<{ adjusted: number }> {
  try {
    const user = await storage.getUser(userId);
    if (!user?.aiCoachEnabled) return { adjusted: 0 };

    const [trainingContext, plans] = await Promise.all([
      buildTrainingContext(userId),
      storage.listTrainingPlans(userId),
    ]);

    const activePlanGoal = plans[0]?.goal ?? undefined;
    const today = toDateStr();
    const timeline = await storage.getTimeline(userId);

    const upcomingWorkouts: UpcomingWorkout[] = timeline
      .filter(
        (entry) =>
          entry.status === "planned" &&
          entry.date >= today &&
          entry.planDayId !== null,
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 7)
      .map((entry) => ({
        id: entry.planDayId || "",
        date: entry.date,
        focus: entry.focus || "",
        mainWorkout: entry.mainWorkout || "",
        accessory: entry.accessory || undefined,
      }));

    if (upcomingWorkouts.length === 0) return { adjusted: 0 };

    const suggestions = await generateWorkoutSuggestions(
      trainingContext,
      upcomingWorkouts,
      activePlanGoal,
    );

    const results = await Promise.all(
      suggestions.map((s) => applySuggestion(s, upcomingWorkouts, userId)),
    );
    const adjusted = results.filter(Boolean).length;

    if (adjusted > 0) {
      logger.info({ userId, adjusted }, "[coach] Auto-coach applied adjustments");
    }
    return { adjusted };
  } catch (error) {
    // Never throw — this is a background, non-critical operation
    logger.error({ err: error, userId }, "[coach] Auto-coach error:");
    return { adjusted: 0 };
  }
}
