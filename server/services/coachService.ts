import { type CoachNoteInputs, type InsertExerciseSet, type PlanDay } from "@shared/schema";

import { db, type DbExecutor } from "../db";
import { AppError, ErrorCode } from "../errors";
import {
  generateReviewNotes,
  generateWorkoutSuggestions,
  type TrainingContext,
  type UpcomingWorkout,
  type WorkoutSuggestion,
} from "../gemini/index";
import { logger } from "../logger";
import { buildWorkoutSearchText } from "../prompts/exerciseSetFormatter";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { checkAiBudget } from "./aiUsageService";
import { retrieveCoachingText } from "./ragRetrieval";
import {
  applyStructuredPlanDaySuggestionRows,
  parseStructuredPlanDaySuggestionRows,
} from "./structuredPlanDaySuggestion";

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

interface PreparedSuggestion {
  readonly suggestion: WorkoutSuggestion;
  readonly structuredSetRows?: InsertExerciseSet[];
}

function hasStructuredExercises(entry: UpcomingWorkout | undefined): boolean {
  return Boolean(entry?.exerciseDetails && entry.exerciseDetails.length > 0);
}

function shouldUseStructuredWrite(suggestion: WorkoutSuggestion, entry: UpcomingWorkout | undefined): boolean {
  return hasStructuredExercises(entry) && suggestion.targetField !== "notes";
}

async function prepareSuggestion(
  suggestion: WorkoutSuggestion,
  upcomingWorkouts: UpcomingWorkout[],
  weightUnit: string,
  userId: string,
): Promise<PreparedSuggestion> {
  const entry = upcomingWorkouts.find((w) => w.id === suggestion.workoutId);
  if (!suggestionWillApply(suggestion, upcomingWorkouts) || !shouldUseStructuredWrite(suggestion, entry)) {
    return { suggestion };
  }

  try {
    const structuredSetRows = await parseStructuredPlanDaySuggestionRows(suggestion, weightUnit, userId);
    if (structuredSetRows.length === 0) return { suggestion };
    return {
      suggestion,
      structuredSetRows,
    };
  } catch (err) {
    logger.warn(
      { err, workoutId: suggestion.workoutId, targetField: suggestion.targetField },
      "[coach] Structured suggestion parse failed; falling back to text update",
    );
    return { suggestion };
  }
}

async function applyStructuredSuggestion(
  prepared: PreparedSuggestion,
  userId: string,
  aiSource: "rag" | "legacy" | null | undefined,
  inputsUsed: CoachNoteInputs,
  tx: DbExecutor,
): Promise<boolean> {
  const { suggestion, structuredSetRows } = prepared;
  if (!structuredSetRows || structuredSetRows.length === 0) return false;

  await applyStructuredPlanDaySuggestionRows(suggestion.workoutId, suggestion.action, structuredSetRows, tx);

  await storage.plans.updatePlanDay(
    suggestion.workoutId,
    {
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

/**
 * Predicate for whether a suggestion will actually apply to one of the
 * upcoming workouts. Kept separate from `applySuggestion` so the caller
 * can pre-compute which upcoming days are "modified" for review-note
 * routing; if we built the modified set from the raw Gemini output, a
 * malformed suggestion would silently cause its day to be skipped in
 * both the modification pass and the review-note pass.
 */
function suggestionWillApply(
  suggestion: WorkoutSuggestion,
  upcomingWorkouts: UpcomingWorkout[],
): boolean {
  // Rationale is also required: applySuggestion persists it as the
  // day's aiRationale, and the TimelineWorkoutCard only renders the
  // coach note when aiRationale is truthy. A suggestion with an empty
  // rationale would leave the athlete looking at a silently-modified
  // workout, which is exactly the trust regression this feature
  // exists to prevent. Kick such suggestions over to the review-note
  // pass so the day still gets a visible note.
  if (!suggestion.workoutId || !suggestion.recommendation || !suggestion.rationale) {
    return false;
  }
  return upcomingWorkouts.some(w => w.id === suggestion.workoutId);
}

async function applySuggestion(
  prepared: PreparedSuggestion,
  upcomingWorkouts: UpcomingWorkout[],
  userId: string,
  aiSource: "rag" | "legacy" | null | undefined,
  inputsUsed: CoachNoteInputs,
  tx: DbExecutor,
): Promise<boolean> {
  const { suggestion } = prepared;
  if (!suggestionWillApply(suggestion, upcomingWorkouts)) return false;
  if (prepared.structuredSetRows && prepared.structuredSetRows.length > 0) {
    return applyStructuredSuggestion(prepared, userId, aiSource, inputsUsed, tx);
  }
  const entry = upcomingWorkouts.find((w) => w.id === suggestion.workoutId)!;

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
  // updatePlanDay returns undefined when the ID doesn't resolve to a row
  // owned by the user; propagate that as a failed apply so a hallucinated
  // workoutId doesn't inflate the "noted" count.
  const result = await storage.plans.updatePlanDay(
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
  return Boolean(result);
}

/**
 * Get coaching materials string — delegates to shared RAG retrieval logic.
 */
async function getCoachingMaterialsString(
  userId: string,
  upcomingWorkouts: UpcomingWorkout[],
  weightUnit?: string,
): Promise<{ text: string | undefined; source: "rag" | "legacy" | null }> {
  const query = upcomingWorkouts.map(w => buildWorkoutSearchText(w, { weightUnit })).join("; ");
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
        ...(w.exerciseDetails && w.exerciseDetails.length > 0 ? { exerciseDetails: w.exerciseDetails } : {}),
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

    const coachingContext = await getCoachingMaterialsString(userId, upcomingWorkouts, user.weightUnit || "kg");
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
    const preparedSuggestions = await Promise.all(
      suggestions.map((s) => prepareSuggestion(s, upcomingWorkouts, user.weightUnit || "kg", userId)),
    );

    // For any upcoming day the coach did NOT modify, request a short review
    // note so the athlete can still see the coach's thinking on that day.
    // Without this, "no suggestions" looks identical to "coach never ran".
    //
    // Build the modified set from suggestions that actually pass the
    // apply-time validation, not from every model output. A malformed
    // suggestion (missing workoutId/recommendation, or targeting an id
    // not in the upcoming slate) would otherwise be dropped in both the
    // modification pass AND the review-note pass, leaving that day with
    // no note at all (C-NOTE-1).
    const modifiedIds = new Set(
      suggestions
        .filter(s => suggestionWillApply(s, upcomingWorkouts))
        .map(s => s.workoutId),
    );
    const unchangedWorkouts = upcomingWorkouts.filter(w => !modifiedIds.has(w.id));
    const unchangedIds = new Set(unchangedWorkouts.map(w => w.id));
    const rawReviewNotes = unchangedWorkouts.length > 0
      ? await generateReviewNotes(
          trainingContext,
          unchangedWorkouts,
          activePlanGoal,
          coachingContext.text,
          userId,
        )
      : [];
    // Drop any review note whose workoutId isn't actually an unchanged day:
    // Gemini occasionally hallucinates IDs, and a review-note write against
    // a modified day would overwrite its aiSource/aiRationale and mislabel
    // it as unchanged. Dedupe on workoutId so the last write doesn't clobber
    // a legitimate note either.
    const reviewNotes = Array.from(
      rawReviewNotes
        .filter(n => unchangedIds.has(n.workoutId))
        .reduce<Map<string, typeof rawReviewNotes[number]>>((acc, n) => {
          acc.set(n.workoutId, n);
          return acc;
        }, new Map())
        .values(),
    );

    // Apply all modifications and review notes atomically: a failure mid-loop
    // rolls back every earlier apply so the plan never ends up partially
    // mutated (C2).
    const { adjusted, noted } = await db.transaction(async (tx) => {
      const modResults: boolean[] = [];
      // Keep duplicate suggestions for the same plan day ordered so structured
      // appends re-read sortOrder after any earlier insert in this transaction.
      for (const s of preparedSuggestions) {
        modResults.push(
          await applySuggestion(s, upcomingWorkouts, userId, coachingContext.source, inputsUsed, tx),
        );
      }
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

// Minimum gap between successive manual regenerations per plan day. Same
// feature burns one Gemini call; without this a frustrated athlete mashing
// Refresh could rack up cost without the note meaningfully changing.
const REGENERATE_COOLDOWN_MS = 30_000;

export interface RegeneratedCoachNote {
  readonly planDayId: string;
  readonly aiRationale: string;
  readonly aiNoteUpdatedAt: Date;
}

export interface RegenerateCooldown {
  readonly retryAfterMs: number;
}

/**
 * Rebuild `plan_days.ai_rationale` on demand for a single planned day after
 * the athlete has edited the day's exercises. Uses the same `generateReviewNotes`
 * pipeline that the auto-coach uses for unchanged upcoming days — "write a
 * short note about why this prescription fits the athlete" — so the tone
 * matches what's already in the UI. Intentionally NOT `generateWorkoutSuggestions`:
 * we don't want the model proposing a modification when the athlete just
 * nudged some numbers.
 *
 * Ownership, AI-consent, and budget guards are enforced by the caller (the
 * route layer) so we can throw typed AppErrors cleanly.
 */
export async function regenerateCoachNoteForPlanDay(
  planDayId: string,
  userId: string,
): Promise<RegeneratedCoachNote | RegenerateCooldown> {
  const day: PlanDay | undefined = await storage.plans.getPlanDay(planDayId, userId);
  if (!day) {
    throw new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404);
  }

  // Cooldown: if the note was just regenerated, bounce the caller with a
  // retry-after hint. Uses aiNoteUpdatedAt as the canonical "last refresh"
  // timestamp — auto-coach writes it on its own apply path, so a manual
  // refresh can't immediately follow an auto-coach regeneration either.
  if (day.aiNoteUpdatedAt) {
    const elapsed = Date.now() - new Date(day.aiNoteUpdatedAt).getTime();
    if (elapsed < REGENERATE_COOLDOWN_MS) {
      return { retryAfterMs: REGENERATE_COOLDOWN_MS - elapsed };
    }
  }

  const trainingContext = await buildTrainingContext(userId);
  const activePlanGoal = trainingContext.activePlan?.goal ?? undefined;
  const planDaySets = await storage.workouts.getExerciseSetsByPlanDay(day.id, userId);

  const workoutInput: UpcomingWorkout = {
    id: day.id,
    date: day.scheduledDate ?? new Date().toISOString().slice(0, 10),
    focus: day.focus,
    mainWorkout: day.mainWorkout,
    accessory: planDaySets && planDaySets.length > 0 ? undefined : day.accessory || undefined,
    notes: planDaySets && planDaySets.length > 0 ? undefined : day.notes || undefined,
    exerciseDetails: (planDaySets ?? []).map(es => ({
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
  };

  const coachingContext = await getCoachingMaterialsString(userId, [workoutInput], trainingContext.weightUnit);
  const inputsUsed = buildCoachNoteInputs(
    trainingContext,
    coachingContext.source === "rag",
    Boolean(activePlanGoal),
  );

  const notes = await generateReviewNotes(
    trainingContext,
    [workoutInput],
    activePlanGoal,
    coachingContext.text,
    userId,
  );
  const note = notes.find((n) => n.workoutId === day.id);
  if (!note?.note) {
    throw new AppError(
      ErrorCode.AI_ERROR,
      "Coach couldn't produce a note right now — try again in a minute.",
      502,
    );
  }

  const aiNoteUpdatedAt = new Date();
  const updated = await storage.plans.updatePlanDay(
    day.id,
    {
      aiSource: "review",
      aiRationale: note.note.slice(0, 400),
      aiNoteUpdatedAt,
      aiInputsUsed: inputsUsed,
    },
    userId,
  );
  if (!updated) {
    // Shouldn't happen — we just confirmed ownership above — but guard
    // anyway so a race on plan-day deletion produces a clear error.
    throw new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404);
  }

  return {
    planDayId: day.id,
    aiRationale: updated.aiRationale ?? note.note.slice(0, 400),
    aiNoteUpdatedAt,
  };
}
