import { generateWorkoutSuggestions, type UpcomingWorkout, type WorkoutSuggestion } from "../gemini/index";
import { logger } from "../logger";
import { checkAiBudget } from "./aiUsageService";
import { storage } from "../storage";
import { toDateStr } from "../types";
import { buildTrainingContext } from "./ai";
import { retrieveCoachingText } from "./ragRetrieval";

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
  aiSource?: "rag" | "legacy" | null,
): Promise<boolean> {
  if (!suggestion.workoutId || !suggestion.recommendation) return false;
  const entry = upcomingWorkouts.find((w) => w.id === suggestion.workoutId);
  if (!entry) return false;

  try {
    const updateValue = buildUpdateValue(suggestion, entry);
    await storage.plans.updatePlanDay(
      suggestion.workoutId,
      { [suggestion.targetField]: updateValue, aiSource: aiSource ?? null },
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

/**
 * Get coaching materials string — delegates to shared RAG retrieval logic.
 */
async function getCoachingMaterialsString(
  userId: string,
  upcomingWorkouts: UpcomingWorkout[],
): Promise<{ text: string | undefined; source: "rag" | "legacy" | null }> {
  const query = upcomingWorkouts.map(w => `${w.focus} ${w.mainWorkout}`).join("; ");
  return retrieveCoachingText(userId, query);
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
    const user = await storage.users.getUser(userId);
    if (!user?.aiCoachEnabled) {
      // Reset in case caller pre-set the flag
      await storage.users.updateIsAutoCoaching(userId, false);
      return { adjusted: 0 };
    }

    // Skip if user is over AI budget — background jobs should not exceed the cap
    const budget = await checkAiBudget(userId);
    if (!budget.allowed) {
      logger.info({ userId }, "[coach] Skipping auto-coach — user AI budget exceeded");
      await storage.users.updateIsAutoCoaching(userId, false);
      return { adjusted: 0 };
    }

    await storage.users.updateIsAutoCoaching(userId, true);

    try {
      // ⚡ Parallelize all three independent data fetches into a single await
      // instead of running getTimeline sequentially after the first two.
      // Saves ~50-100ms of DB round-trip latency per auto-coach trigger.
      const [trainingContext, activePlanRecord, timeline] = await Promise.all([
        buildTrainingContext(userId),
        storage.plans.getActivePlan(userId),
        storage.timeline.getTimeline(userId),
      ]);

      const activePlanGoal = activePlanRecord?.goal ?? undefined;
      const today = toDateStr();

      const upcomingWorkouts: UpcomingWorkout[] = timeline
        .filter(
          (entry) =>
            entry.status === "planned" &&
            entry.date >= today &&
            entry.planDayId !== null,
        )
        // Fast string comparison for YYYY-MM-DD dates instead of localeCompare
        .sort((a, b) => {
          if (b.date < a.date) return 1;
          if (b.date > a.date) return -1;
          return 0;
        })
        .slice(0, 7)
        .map((entry) => ({
          id: entry.planDayId || "",
          date: entry.date,
          focus: entry.focus || "",
          mainWorkout: entry.mainWorkout || "",
          accessory: entry.accessory || undefined,
          notes: entry.notes || undefined,
        }));

      if (upcomingWorkouts.length === 0) return { adjusted: 0 };

      const coachingContext = await getCoachingMaterialsString(userId, upcomingWorkouts);

      const suggestions = await generateWorkoutSuggestions(
        trainingContext,
        upcomingWorkouts,
        activePlanGoal,
        coachingContext.text,
        userId,
      );

      const results = await Promise.all(
        suggestions.map((s) => applySuggestion(s, upcomingWorkouts, userId, coachingContext.source)),
      );
      const adjusted = results.filter(Boolean).length;

      if (adjusted > 0) {
        logger.info({ userId, adjusted }, "[coach] Auto-coach applied adjustments");
      }
      return { adjusted };
    } finally {
      await storage.users.updateIsAutoCoaching(userId, false);
    }
  } catch (error) {
    logger.error({ err: error, userId }, "[coach] Auto-coach error:");
    throw error; // Let the queue handle retries
  }
}
