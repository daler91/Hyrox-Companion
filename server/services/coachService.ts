import type { CoachNoteInputs } from "@shared/schema";

import { db, type DbExecutor } from "../db";
import {
  generateReviewNotes,
  generateWorkoutSuggestions,
  type TrainingContext,
  type UpcomingWorkout,
  type WorkoutSuggestion,
} from "../gemini/index";
import { logger } from "../logger";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { checkAiBudget } from "./aiUsageService";
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

/**
 * Capture a compact audit of which inputs were present when the coach
 * produced the note for a plan day. Persisted as `plan_days.ai_inputs_used`
 * so the athlete sees "Based on: RPE trend · plan phase · coaching docs"
 * on the workout card.
 */
function buildCoachNoteInputs(
  ctx: TrainingContext,
  ragUsed: boolean,
  planGoalPresent: boolean,
): CoachNoteInputs {
  const insights = ctx.coachingInsights;
  return {
    rpeTrend: insights?.rpeTrend,
    fatigueFlag: insights?.fatigueFlag,
    planPhase: insights?.planPhase?.phaseLabel,
    weeklyVolumeTrend: insights?.weeklyVolume?.trend,
    stationGaps: insights?.stationGaps
      ?.filter(g => g.daysSinceLastTrained === null || g.daysSinceLastTrained >= 10)
      .map(g => g.station),
    progressionFlags: insights?.progressionFlags
      ?.filter(f => f.flag === "plateau" || f.flag === "regressing")
      .map(f => `${f.exercise}:${f.flag}`),
    ragUsed,
    recentWorkoutCount: ctx.recentWorkouts?.length ?? 0,
    planGoalPresent,
  };
}

async function applySuggestion(
  suggestion: WorkoutSuggestion,
  upcomingWorkouts: UpcomingWorkout[],
  userId: string,
  aiSource: "rag" | "legacy" | null | undefined,
  inputsUsed: CoachNoteInputs,
  tx: DbExecutor,
): Promise<boolean> {
  if (!suggestion.workoutId || !suggestion.recommendation) return false;
  const entry = upcomingWorkouts.find((w) => w.id === suggestion.workoutId);
  if (!entry) return false;

  // Let errors propagate so the enclosing transaction rolls back — we want
  // all-or-nothing semantics for the auto-coach apply loop (C2).
  const updateValue = buildUpdateValue(suggestion, entry);
  await storage.plans.updatePlanDay(
    suggestion.workoutId,
    {
      [suggestion.targetField]: updateValue,
      aiSource: aiSource ?? null,
      aiRationale: suggestion.rationale.slice(0, 400),
      aiNoteUpdatedAt: new Date(),
      aiInputsUsed: inputsUsed,
    },
    userId,
    tx,
  );
  return true;
}

async function applyReviewNote(
  workoutId: string,
  note: string,
  userId: string,
  inputsUsed: CoachNoteInputs,
  tx: DbExecutor,
): Promise<boolean> {
  if (!workoutId || !note) return false;
  await storage.plans.updatePlanDay(
    workoutId,
    {
      aiSource: "review",
      aiRationale: note.slice(0, 400),
      aiNoteUpdatedAt: new Date(),
      aiInputsUsed: inputsUsed,
    },
    userId,
    tx,
  );
  return true;
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
    if (!user?.aiCoachEnabled) return { adjusted: 0 };

    // Skip if user is over AI budget — background jobs should not exceed the cap
    const budget = await checkAiBudget(userId);
    if (!budget.allowed) {
      logger.info({ userId }, "[coach] Skipping auto-coach — user AI budget exceeded");
      return { adjusted: 0 };
    }

    await storage.users.updateIsAutoCoaching(userId, true);

    // buildTrainingContext already fetches the active plan, upcoming
    // planned days, and recent timeline — reuse its results instead of
    // issuing duplicate getTimeline + getActivePlan calls.
    const trainingContext = await buildTrainingContext(userId);

    const activePlanGoal = trainingContext.activePlan?.goal ?? undefined;

    // Map the training context's upcoming workouts to the shape expected
    // by the suggestion generator.
    const upcomingWorkouts: UpcomingWorkout[] = (trainingContext.upcomingWorkouts ?? [])
      .filter((w) => w.planDayId)
      .map((w) => ({
        id: w.planDayId!,
        date: w.date,
        focus: w.focus,
        mainWorkout: w.mainWorkout,
        accessory: w.accessory || undefined,
        notes: w.notes || undefined,
      }));

    if (upcomingWorkouts.length === 0) {
      // Legitimate no-op: user has no active plan or the plan has no future
      // planned days. Log so support can distinguish this from an AI/API
      // failure (W3).
      logger.info(
        { userId, planName: trainingContext.activePlan?.name },
        "[coach] Auto-coach skipped — no upcoming planned workouts",
      );
      return { adjusted: 0 };
    }

    const coachingContext = await getCoachingMaterialsString(userId, upcomingWorkouts);
    const inputsUsed = buildCoachNoteInputs(
      trainingContext,
      coachingContext.source === "rag",
      Boolean(activePlanGoal),
    );

    const suggestions = await generateWorkoutSuggestions(
      trainingContext,
      upcomingWorkouts,
      activePlanGoal,
      coachingContext.text,
      userId,
    );

    // For any upcoming day the coach did NOT modify, request a short review
    // note so the athlete can still see the coach's thinking on that day.
    // Without this, "no suggestions" looks identical to "coach never ran".
    const modifiedIds = new Set(suggestions.map(s => s.workoutId));
    const unchangedWorkouts = upcomingWorkouts.filter(w => !modifiedIds.has(w.id));
    const reviewNotes = unchangedWorkouts.length > 0
      ? await generateReviewNotes(
          trainingContext,
          unchangedWorkouts,
          activePlanGoal,
          coachingContext.text,
          userId,
        )
      : [];

    // Apply all modifications and review notes atomically: a failure mid-loop
    // rolls back every earlier apply so the plan never ends up partially
    // mutated (C2).
    const { adjusted, noted } = await db.transaction(async (tx) => {
      const modResults = await Promise.all(
        suggestions.map((s) =>
          applySuggestion(s, upcomingWorkouts, userId, coachingContext.source, inputsUsed, tx),
        ),
      );
      const noteResults = await Promise.all(
        reviewNotes.map((n) =>
          applyReviewNote(n.workoutId, n.note, userId, inputsUsed, tx),
        ),
      );
      return {
        adjusted: modResults.filter(Boolean).length,
        noted: noteResults.filter(Boolean).length,
      };
    });

    if (adjusted > 0 || noted > 0) {
      logger.info({ userId, adjusted, noted }, "[coach] Auto-coach applied adjustments and notes");
    }
    return { adjusted };
  } catch (error) {
    logger.error({ err: error, userId }, "[coach] Auto-coach error:");
    throw error; // Let the queue handle retries
  } finally {
    // Always reset the flag, regardless of success / error / early return.
    // The caller (workoutService.createWorkoutAndScheduleCoaching) pre-sets
    // isAutoCoaching=true inside the workout-creation transaction, so even
    // early-return paths and pre-flag errors must clear it here. Wrap in a
    // nested try so a failure to reset doesn't mask the original error.
    try {
      await storage.users.updateIsAutoCoaching(userId, false);
    } catch (resetErr) {
      logger.error(
        { err: resetErr, userId },
        "[coach] Failed to reset isAutoCoaching flag",
      );
    }
  }
}
