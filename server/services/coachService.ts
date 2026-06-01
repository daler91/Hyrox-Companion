import {
  type CoachNoteInputs,
  type InsertExerciseSet,
  type PlanDay,
  type UpdatePlanDay,
} from "@shared/schema";
import { normalizeWorkoutTextUnits, type UnitPreferences } from "@shared/unitConversion";

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
import {
  buildSignalsFromTrainingContext,
  buildStructuredResultingWorkout,
  buildTextResultingWorkout,
  type CoachModificationSignals,
  shouldSuppressRepeatedFatigueReduction,
  withCoachModificationMetadata,
} from "./aiModificationGuard";
import {
  analyzeSafetySignals,
  applySafetyLayerToSuggestions,
  buildSafetyReviewNote,
} from "./aiSafety";
import { checkAiBudget } from "./aiUsageService";
import { retrieveCoachingText } from "./ragRetrieval";
import {
  applyStructuredPlanDaySuggestionRows,
  parseStructuredPlanDaySuggestionRows,
} from "./structuredPlanDaySuggestion";
import { resolveTrainingStyle } from "./training_styles";
import type { TrainingStylePromptContext } from "./training_styles/types";
import { buildLoadGovernorSuggestions, type LoadGovernorSuggestion } from "./trainingLoadGovernor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AutoCoachAiSource = "rag" | "legacy" | "load_governor" | null | undefined;

function getExistingFieldValue(suggestion: WorkoutSuggestion, entry: UpcomingWorkout): string {
  if (suggestion.targetField === "mainWorkout") return entry.mainWorkout;
  if (suggestion.targetField === "accessory") return entry.accessory || "";
  return "";
}

function buildUpdateValue(suggestion: WorkoutSuggestion, entry: UpcomingWorkout): string {
  if (suggestion.action !== "append") return suggestion.recommendation;
  const existing = getExistingFieldValue(suggestion, entry);
  return existing
    ? `${existing}\n[AI Coach] ${suggestion.recommendation}`
    : `[AI Coach] ${suggestion.recommendation}`;
}

/**
 * Preserve the "Originally planned" snapshot across coach-note rewrites.
 * `aiInputsUsed` is rebuilt from scratch on every coach run (and by review
 * notes / manual refreshes), so without this the record captured when a day
 * was converted would be wiped the next time the coach touches that day. Only
 * carries the prior value forward when the fresh inputs don't already set one —
 * a genuine new conversion always wins.
 */
function carryReplacedPrescription(
  next: CoachNoteInputs,
  prior: CoachNoteInputs | null | undefined,
): CoachNoteInputs {
  if (next.replacedPrescription || !prior?.replacedPrescription) return next;
  return { ...next, replacedPrescription: prior.replacedPrescription };
}

interface PreparedSuggestion {
  readonly suggestion: WorkoutSuggestion;
  readonly structuredSetRows?: InsertExerciseSet[];
  readonly aiSourceOverride?: AutoCoachAiSource;
  readonly requiresStructuredWrite?: boolean;
  readonly rationaleCode?: string;
  readonly focusOverride?: string;
}

interface AppliedSuggestionResult {
  readonly applied: boolean;
  readonly inputsUsed?: CoachNoteInputs;
}

interface SuggestionApplyContext {
  readonly upcomingWorkouts: UpcomingWorkout[];
  readonly userId: string;
  readonly aiSource: AutoCoachAiSource;
  readonly inputsUsed: CoachNoteInputs;
  readonly coachSignals: CoachModificationSignals;
  readonly unitPreferences: UnitPreferences;
  readonly tx: DbExecutor;
}

type ReviewNote = Awaited<ReturnType<typeof generateReviewNotes>>[number];

interface UnchangedWorkoutSelection {
  readonly workouts: UpcomingWorkout[];
  readonly ids: Set<string>;
}

interface ReviewNotesInput {
  readonly trainingContext: TrainingContext;
  readonly unchangedWorkouts: UpcomingWorkout[];
  readonly activePlanGoal: string | undefined;
  readonly coachingText: string | undefined;
  readonly userId: string;
  readonly stylePromptContext: TrainingStylePromptContext;
  readonly forcedSafetyNote: string | null;
}

interface AutoCoachApplyInput {
  readonly preparedSuggestions: PreparedSuggestion[];
  readonly upcomingWorkouts: UpcomingWorkout[];
  readonly userId: string;
  readonly aiSource: AutoCoachAiSource;
  readonly inputsUsed: CoachNoteInputs;
  readonly coachSignals: CoachModificationSignals;
  readonly unitPreferences: UnitPreferences;
  readonly reviewNotes: ReviewNote[];
}

function hasStructuredExercises(entry: UpcomingWorkout | undefined): boolean {
  return Boolean(entry?.exerciseDetails && entry.exerciseDetails.length > 0);
}

function shouldUseStructuredWrite(
  suggestion: WorkoutSuggestion,
  entry: UpcomingWorkout | undefined,
): boolean {
  return hasStructuredExercises(entry) && suggestion.targetField !== "notes";
}

async function prepareSuggestion(
  suggestion: WorkoutSuggestion,
  upcomingWorkouts: UpcomingWorkout[],
  unitPreferences: UnitPreferences,
  userId: string,
): Promise<PreparedSuggestion> {
  const entry = upcomingWorkouts.find((w) => w.id === suggestion.workoutId);
  if (
    !suggestionWillApply(suggestion, upcomingWorkouts) ||
    !shouldUseStructuredWrite(suggestion, entry)
  ) {
    return { suggestion };
  }

  try {
    const structuredSetRows = await parseStructuredPlanDaySuggestionRows(
      suggestion,
      unitPreferences,
      userId,
    );
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

function prepareLoadGovernorSuggestion(suggestion: LoadGovernorSuggestion): PreparedSuggestion {
  return {
    suggestion: suggestion.suggestion,
    structuredSetRows: suggestion.structuredSetRows,
    aiSourceOverride: "load_governor",
    requiresStructuredWrite: Boolean(suggestion.structuredSetRows?.length),
    rationaleCode: suggestion.rationaleCode,
    focusOverride: suggestion.focusOverride,
  };
}

async function applyStructuredSuggestion(
  prepared: PreparedSuggestion,
  entry: UpcomingWorkout,
  resolvedSource: AutoCoachAiSource,
  context: SuggestionApplyContext,
): Promise<AppliedSuggestionResult> {
  const { userId, inputsUsed, coachSignals, unitPreferences, tx } = context;
  const { suggestion, structuredSetRows, focusOverride } = prepared;
  if (!structuredSetRows || structuredSetRows.length === 0) {
    return { applied: false };
  }
  const resultingWorkout = buildStructuredResultingWorkout(
    entry,
    suggestion.action,
    structuredSetRows,
  );
  let suggestionInputs = withCoachModificationMetadata(
    inputsUsed,
    suggestion,
    coachSignals,
    resultingWorkout,
  );

  await applyStructuredPlanDaySuggestionRows(
    suggestion.workoutId,
    suggestion.action,
    structuredSetRows,
    tx,
  );

  const updates: UpdatePlanDay = {
    aiSource: resolvedSource ?? null,
    aiRationale: suggestion.rationale.slice(0, 400),
    aiNoteUpdatedAt: new Date(),
  };

  // A structured "replace" swaps the day's entire prescription, so the
  // free-text fields and title that described the old exercises are now stale
  // (and contradict the new rows). Reconcile them to the new session: drop the
  // recommendation into mainWorkout (unit-normalized like the text path) and
  // clear accessory/notes — the replace already deleted every prior set row, so
  // nothing they described survives. "append" leaves the prescription intact.
  if (suggestion.action === "replace") {
    const rawMain = suggestion.recommendation;
    updates.mainWorkout = normalizeWorkoutTextUnits(rawMain, unitPreferences) ?? rawMain;
    updates.accessory = null;
    updates.notes = null;

    // Only the governor supplies a new title, and we rename — capturing the
    // original prescription once — only when it actually changes the title.
    // A repeat coach pass on an already-converted day sees the same title and
    // skips, so the recovery run is never recorded as the "original".
    const newFocus = focusOverride?.trim();
    if (newFocus && newFocus.toLowerCase() !== entry.focus.trim().toLowerCase()) {
      updates.focus = newFocus;
      suggestionInputs = {
        ...suggestionInputs,
        replacedPrescription: {
          focus: entry.focus,
          mainWorkout: entry.mainWorkout,
          accessory: entry.accessory ?? null,
          notes: entry.notes ?? null,
        },
      };
    }
  }

  suggestionInputs = carryReplacedPrescription(suggestionInputs, entry.aiInputsUsed);
  updates.aiInputsUsed = suggestionInputs;

  await storage.plans.updatePlanDay(suggestion.workoutId, updates, userId, tx);
  return { applied: true, inputsUsed: suggestionInputs };
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
    loadGovernorAcwrZone: insights?.loadGovernor?.zone,
    loadGovernorAcwr: insights?.loadGovernor?.acwr ?? undefined,
    loadGovernorFlaggedVectors: insights?.loadGovernor?.flaggedVectors,
    loadGovernorRestrictions: insights?.loadGovernor?.activeRestrictions.map((r) => r.id),
    stationGaps: insights?.stationGaps
      ?.filter((g) => g.daysSinceLastTrained === null || g.daysSinceLastTrained >= 10)
      .map((g) => g.station),
    progressionFlags: insights?.progressionFlags
      ?.filter((f) => f.flag === "plateau" || f.flag === "regressing")
      .map((f) => `${f.exercise}:${f.flag}`),
    ragUsed,
    recentWorkoutCount: ctx.recentWorkouts?.length ?? 0,
    completedWorkoutCount: ctx.completedWorkouts,
    planGoalPresent,
  };
}

/**
 * Predicate for whether a suggestion will actually apply to one of the
 * upcoming workouts. Kept separate from `applySuggestion` so the caller
 * can pre-compute which upcoming days are "modified" for review-note
 * routing; if we built the modified set from the raw provider output, a
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
  return upcomingWorkouts.some((w) => w.id === suggestion.workoutId);
}

async function applySuggestion(
  prepared: PreparedSuggestion,
  context: SuggestionApplyContext,
): Promise<AppliedSuggestionResult> {
  const { suggestion } = prepared;
  const { upcomingWorkouts, userId, aiSource, inputsUsed, coachSignals, unitPreferences, tx } =
    context;
  if (!suggestionWillApply(suggestion, upcomingWorkouts)) {
    return { applied: false };
  }
  const entry = upcomingWorkouts.find((w) => w.id === suggestion.workoutId)!;
  const resolvedSource = prepared.aiSourceOverride ?? aiSource;
  if (
    prepared.requiresStructuredWrite &&
    shouldUseStructuredWrite(suggestion, entry) &&
    (!prepared.structuredSetRows || prepared.structuredSetRows.length === 0)
  ) {
    return { applied: false };
  }
  if (prepared.structuredSetRows && prepared.structuredSetRows.length > 0) {
    return applyStructuredSuggestion(prepared, entry, resolvedSource, context);
  }

  // Let errors propagate so the enclosing transaction rolls back — we want
  // all-or-nothing semantics for the auto-coach apply loop (C2).
  const rawUpdateValue = buildUpdateValue(suggestion, entry);
  const updateValue = normalizeWorkoutTextUnits(rawUpdateValue, unitPreferences) ?? rawUpdateValue;
  const suggestionInputs = carryReplacedPrescription(
    withCoachModificationMetadata(
      inputsUsed,
      suggestion,
      coachSignals,
      buildTextResultingWorkout(entry, suggestion.targetField, updateValue),
    ),
    entry.aiInputsUsed,
  );
  await storage.plans.updatePlanDay(
    suggestion.workoutId,
    {
      [suggestion.targetField]: updateValue,
      aiSource: resolvedSource ?? null,
      aiRationale: suggestion.rationale.slice(0, 400),
      aiNoteUpdatedAt: new Date(),
      aiInputsUsed: suggestionInputs,
    },
    userId,
    tx,
  );
  return { applied: true, inputsUsed: suggestionInputs };
}

async function applyReviewNote(
  workoutId: string,
  note: string,
  userId: string,
  inputsUsed: CoachNoteInputs,
  priorInputs: CoachNoteInputs | null | undefined,
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
      // A review note on a previously-converted day must not erase its
      // "Originally planned" record.
      aiInputsUsed: carryReplacedPrescription(inputsUsed, priorInputs),
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
  unitPreferences: UnitPreferences,
): Promise<{ text: string | undefined; source: "rag" | "legacy" | null }> {
  const query = upcomingWorkouts.map((w) => buildWorkoutSearchText(w, unitPreferences)).join("; ");
  return retrieveCoachingText(userId, query);
}

function buildUpcomingWorkoutInputs(trainingContext: TrainingContext): UpcomingWorkout[] {
  return (trainingContext.upcomingWorkouts ?? [])
    .filter((w) => w.planDayId)
    .map((w) => ({
      id: w.planDayId!,
      date: w.date,
      focus: w.focus,
      mainWorkout: w.mainWorkout,
      accessory: w.accessory || undefined,
      notes: w.notes || undefined,
      aiSource: w.aiSource,
      aiRationale: w.aiRationale,
      aiNoteUpdatedAt: w.aiNoteUpdatedAt,
      aiInputsUsed: w.aiInputsUsed,
      ...(w.exerciseDetails && w.exerciseDetails.length > 0
        ? { exerciseDetails: w.exerciseDetails }
        : {}),
    }));
}

function collectModifiedWorkoutIds(
  suggestions: WorkoutSuggestion[],
  upcomingWorkouts: UpcomingWorkout[],
): Set<string> {
  const modifiedIds = new Set<string>();
  for (const suggestion of suggestions) {
    if (suggestionWillApply(suggestion, upcomingWorkouts)) {
      modifiedIds.add(suggestion.workoutId);
    }
  }
  return modifiedIds;
}

function selectUnchangedWorkouts(
  upcomingWorkouts: UpcomingWorkout[],
  modifiedIds: Set<string>,
): UnchangedWorkoutSelection {
  const workouts: UpcomingWorkout[] = [];
  const ids = new Set<string>();
  for (const workout of upcomingWorkouts) {
    if (!modifiedIds.has(workout.id)) {
      workouts.push(workout);
      ids.add(workout.id);
    }
  }
  return { workouts, ids };
}

async function buildReviewNotes({
  trainingContext,
  unchangedWorkouts,
  activePlanGoal,
  coachingText,
  userId,
  stylePromptContext,
  forcedSafetyNote,
}: ReviewNotesInput): Promise<ReviewNote[]> {
  if (unchangedWorkouts.length === 0) return [];
  if (forcedSafetyNote) {
    return unchangedWorkouts.map((workout) => ({
      workoutId: workout.id,
      note: forcedSafetyNote,
    }));
  }
  return generateReviewNotes(
    trainingContext,
    unchangedWorkouts,
    activePlanGoal,
    coachingText,
    userId,
    stylePromptContext,
  );
}

function deduplicateReviewNotes(
  rawReviewNotes: ReviewNote[],
  unchangedIds: Set<string>,
): ReviewNote[] {
  const deduplicatedNotes = new Map<string, ReviewNote>();
  for (const note of rawReviewNotes) {
    if (unchangedIds.has(note.workoutId)) {
      deduplicatedNotes.set(note.workoutId, note);
    }
  }
  return Array.from(deduplicatedNotes.values());
}

async function applyAutoCoachChanges({
  preparedSuggestions,
  upcomingWorkouts,
  userId,
  aiSource,
  inputsUsed,
  coachSignals,
  unitPreferences,
  reviewNotes,
}: AutoCoachApplyInput): Promise<{ adjusted: number; noted: number }> {
  return db.transaction(async (tx) => {
    const modResults: AppliedSuggestionResult[] = [];
    const inputsByWorkoutId = new Map<string, CoachNoteInputs>();
    // Keep duplicate suggestions for the same plan day ordered so structured
    // appends re-read sortOrder after any earlier insert in this transaction.
    for (const prepared of preparedSuggestions) {
      const currentInputs = inputsByWorkoutId.get(prepared.suggestion.workoutId) ?? inputsUsed;
      const result = await applySuggestion(prepared, {
        upcomingWorkouts,
        userId,
        aiSource,
        inputsUsed: currentInputs,
        coachSignals,
        unitPreferences,
        tx,
      });
      modResults.push(result);
      if (result.applied && result.inputsUsed) {
        inputsByWorkoutId.set(prepared.suggestion.workoutId, result.inputsUsed);
      }
    }
    const workoutById = new Map(upcomingWorkouts.map((workout) => [workout.id, workout]));
    const noteResults = await Promise.all(
      reviewNotes.map((note) =>
        applyReviewNote(
          note.workoutId,
          note.note,
          userId,
          inputsUsed,
          workoutById.get(note.workoutId)?.aiInputsUsed,
          tx,
        ),
      ),
    );

    let adjustedCount = 0;
    let notedCount = 0;
    for (const result of modResults) if (result.applied) adjustedCount++;
    for (const result of noteResults) if (result) notedCount++;

    return {
      adjusted: adjustedCount,
      noted: notedCount,
    };
  });
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

    const upcomingWorkouts = buildUpcomingWorkoutInputs(trainingContext);

    const resolvedStyle = resolveTrainingStyle(user.trainingStyleId);
    const stylePromptContext = resolvedStyle.strategy.buildPromptContext(
      trainingContext,
      upcomingWorkouts,
    );

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

    const unitPreferences = {
      weightUnit: user.weightUnit || "kg",
      distanceUnit: user.distanceUnit || "km",
    };
    const coachingContext = await getCoachingMaterialsString(
      userId,
      upcomingWorkouts,
      unitPreferences,
    );
    const inputsUsed = buildCoachNoteInputs(
      trainingContext,
      coachingContext.source === "rag",
      Boolean(activePlanGoal),
    );

    const safetySignals = analyzeSafetySignals(trainingContext, upcomingWorkouts);
    const loadGovernorPreparedSuggestions = trainingContext.coachingInsights?.loadGovernor
      ? buildLoadGovernorSuggestions(
          trainingContext.coachingInsights.loadGovernor,
          upcomingWorkouts,
        ).map(prepareLoadGovernorSuggestion)
      : [];
    const loadGovernorModifiedIds = collectModifiedWorkoutIds(
      loadGovernorPreparedSuggestions.map((prepared) => prepared.suggestion),
      upcomingWorkouts,
    );

    const rawSuggestions = await generateWorkoutSuggestions(
      trainingContext,
      upcomingWorkouts,
      activePlanGoal,
      coachingContext.text,
      userId,
      stylePromptContext,
    );
    const safetyAdjustedSuggestions = applySafetyLayerToSuggestions(rawSuggestions, safetySignals);
    const workoutMap = new Map(upcomingWorkouts.map((w) => [w.id, w]));
    const coachSignals = buildSignalsFromTrainingContext(trainingContext);
    const suggestions = safetyAdjustedSuggestions.filter(
      (suggestion) =>
        !loadGovernorModifiedIds.has(suggestion.workoutId) &&
        !shouldSuppressRepeatedFatigueReduction(
          suggestion,
          workoutMap.get(suggestion.workoutId),
          coachSignals,
        ),
    );
    const preparedSuggestions = await Promise.all(
      suggestions.map((s) => prepareSuggestion(s, upcomingWorkouts, unitPreferences, userId)),
    );
    const allPreparedSuggestions = [
      ...loadGovernorPreparedSuggestions,
      ...preparedSuggestions,
    ];

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
    const modifiedIds = collectModifiedWorkoutIds(
      allPreparedSuggestions.map((prepared) => prepared.suggestion),
      upcomingWorkouts,
    );

    const unchanged = selectUnchangedWorkouts(upcomingWorkouts, modifiedIds);

    const forcedSafetyNote = buildSafetyReviewNote(safetySignals);
    const rawReviewNotes = await buildReviewNotes({
      trainingContext,
      unchangedWorkouts: unchanged.workouts,
      activePlanGoal,
      coachingText: coachingContext.text,
      userId,
      stylePromptContext,
      forcedSafetyNote,
    });
    // Drop any review note whose workoutId isn't actually an unchanged day:
    // AI providers occasionally hallucinate IDs, and a review-note write against
    // a modified day would overwrite its aiSource/aiRationale and mislabel
    // it as unchanged. Dedupe on workoutId so the last write doesn't clobber
    // a legitimate note either.
    const reviewNotes = deduplicateReviewNotes(rawReviewNotes, unchanged.ids);

    // Apply all modifications and review notes atomically: a failure mid-loop
    // rolls back every earlier apply so the plan never ends up partially
    // mutated (C2).
    const { adjusted, noted } = await applyAutoCoachChanges({
      preparedSuggestions: allPreparedSuggestions,
      upcomingWorkouts,
      userId,
      aiSource: coachingContext.source,
      inputsUsed,
      coachSignals,
      unitPreferences,
      reviewNotes,
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
      logger.error({ err: resetErr, userId }, "[coach] Failed to reset isAutoCoaching flag");
    }
  }
}

// Minimum gap between successive manual regenerations per plan day. Same
// feature burns one AI provider call; without this a frustrated athlete mashing
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
  const user = await storage.users.getUser(userId);
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
    exerciseDetails: (planDaySets ?? []).map((es) => ({
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

  const coachingContext = await getCoachingMaterialsString(userId, [workoutInput], {
    weightUnit: trainingContext.weightUnit,
    distanceUnit: trainingContext.distanceUnit,
  });
  const resolvedStyle = resolveTrainingStyle(user?.trainingStyleId);
  const stylePromptContext = resolvedStyle.strategy.buildPromptContext(trainingContext, [
    workoutInput,
  ]);
  const inputsUsed = buildCoachNoteInputs(
    trainingContext,
    coachingContext.source === "rag",
    Boolean(activePlanGoal),
  );

  const safetySignals = analyzeSafetySignals(trainingContext, [workoutInput]);
  const forcedSafetyNote = buildSafetyReviewNote(safetySignals);

  const notes = forcedSafetyNote
    ? [{ workoutId: day.id, note: forcedSafetyNote }]
    : await generateReviewNotes(
        trainingContext,
        [workoutInput],
        activePlanGoal,
        coachingContext.text,
        userId,
        stylePromptContext,
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
      // Don't drop a prior conversion's "Originally planned" record when the
      // athlete manually refreshes the coach note.
      aiInputsUsed: carryReplacedPrescription(inputsUsed, day.aiInputsUsed),
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
