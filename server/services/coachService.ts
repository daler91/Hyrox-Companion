import { logger } from "../logger";
import { storage } from "../storage";
import { buildTrainingContext } from "./aiService";
import { generateWorkoutSuggestions, type UpcomingWorkout } from "../gemini/index";
import { toDateStr } from "../types";

/**
 * Auto-coach: fires after a workout is completed.
 * Reads the user's active plan goal + recent performance, then applies AI-suggested
 * adjustments directly to upcoming plan_days. Fire-and-forget — never throws.
 */
export async function triggerAutoCoach(userId: string): Promise<{ adjusted: number }> {
  try {
    const user = await storage.getUser(userId);
    if (!user?.aiCoachEnabled) {
      return { adjusted: 0 };
    }

    const [trainingContext, plans] = await Promise.all([
      buildTrainingContext(userId),
      storage.listTrainingPlans(userId),
    ]);

    // Extract the goal from the active plan (first plan)
    const activePlanGoal = plans.length > 0 ? (plans[0].goal ?? undefined) : undefined;

    const timeline = await storage.getTimeline(userId);
    const today = toDateStr();

    const upcomingWorkouts: UpcomingWorkout[] = timeline
      .filter(
        (entry) =>
          entry.status === "planned" &&
          entry.date &&
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

    if (upcomingWorkouts.length === 0) {
      return { adjusted: 0 };
    }

    const suggestions = await generateWorkoutSuggestions(
      trainingContext,
      upcomingWorkouts,
      activePlanGoal,
    );

    let adjusted = 0;
    for (const suggestion of suggestions) {
      if (!suggestion.workoutId || !suggestion.recommendation) continue;

      try {
        // Find the current plan day to build the merged update
        const entry = upcomingWorkouts.find((w) => w.id === suggestion.workoutId);
        if (!entry) continue;

        let updateValue: string;
        if (suggestion.action === "append") {
          const existingValue =
            suggestion.targetField === "mainWorkout"
              ? entry.mainWorkout
              : suggestion.targetField === "accessory"
                ? entry.accessory || ""
                : "";
          updateValue = existingValue
            ? `${existingValue}\n[AI Coach] ${suggestion.recommendation}`
            : `[AI Coach] ${suggestion.recommendation}`;
        } else {
          updateValue = suggestion.recommendation;
        }

        await storage.updatePlanDay(
          suggestion.workoutId,
          { [suggestion.targetField]: updateValue },
          userId,
        );
        adjusted++;
      } catch (applyErr) {
        logger.warn(
          { err: applyErr, workoutId: suggestion.workoutId },
          "[coach] Failed to apply suggestion to plan day:",
        );
      }
    }

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
