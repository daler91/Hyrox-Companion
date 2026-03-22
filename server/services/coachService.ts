import { logger } from "../logger";
import { storage } from "../storage";
import { buildTrainingContext } from "./aiService";
import { generateWorkoutSuggestions, type UpcomingWorkout, type WorkoutSuggestion } from "../gemini/index";
import { buildCoachingMaterialsSection, buildRetrievedChunksSection } from "../prompts";
import { retrieveRelevantChunks } from "./ragService";
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
  aiSource?: "rag" | "legacy" | null,
): Promise<boolean> {
  if (!suggestion.workoutId || !suggestion.recommendation) return false;
  const entry = upcomingWorkouts.find((w) => w.id === suggestion.workoutId);
  if (!entry) return false;

  try {
    const updateValue = buildUpdateValue(suggestion, entry);
    await storage.updatePlanDay(
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
 * Get coaching materials string — try RAG first, fall back to legacy truncation.
 */
async function getCoachingMaterialsString(
  userId: string,
  upcomingWorkouts: UpcomingWorkout[],
): Promise<{ text: string | undefined; source: "rag" | "legacy" | null }> {
  try {
    const hasChunks = await storage.hasChunksForUser(userId);
    if (hasChunks) {
      const query = upcomingWorkouts.map(w => `${w.focus} ${w.mainWorkout}`).join("; ");
      const chunks = await retrieveRelevantChunks(userId, query);
      if (chunks.length > 0) {
        return { text: buildRetrievedChunksSection(chunks), source: "rag" };
      }
    }
  } catch (error) {
    logger.warn({ err: error, userId }, "[coach] RAG retrieval failed, falling back to legacy");
  }

  const materials = await storage.listCoachingMaterials(userId);
  const text = buildCoachingMaterialsSection(materials) || undefined;
  return { text, source: text ? "legacy" : null };
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
    if (user.isAutoCoaching) return { adjusted: 0 }; // Prevent overlapping runs

    await storage.updateIsAutoCoaching(userId, true);

    try {
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
      await storage.updateIsAutoCoaching(userId, false);
    }
  } catch (error) {
    logger.error({ err: error, userId }, "[coach] Auto-coach error:");
    throw error; // Let the queue handle retries
  }
}
