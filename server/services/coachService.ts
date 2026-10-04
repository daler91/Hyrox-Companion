import { appendCoachBlock, appendCoachCue } from "@shared/coachNotes";
import { inSequence } from "@shared/inSequence";
import { type CoachNoteInputs, type InsertExerciseSet, type UpdatePlanDay } from "@shared/schema";
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
  mapExerciseSetToPromptDetail,
  shouldSuppressRepeatedFatigueReduction,
  withCoachModificationMetadata,
} from "./aiModificationGuard";
import {
  analyzeSafetySignals,
  applySafetyLayerToSuggestions,
  buildSafetyReviewNote,
} from "./aiSafety";
import { checkAiBudget } from "./aiUsageService";
import { lockAutoCoachWriteTargets } from "./autoCoachWriteGuard";
import { buildCoachNoteInputs } from "./coachNoteInputs";
import {
  adaptedDayIds,
  applyPlanAdaptation,
  computePlanAdaptation,
  type PlanAdaptation,
} from "./planAdaptationService";
import { retrieveCoachingText } from "./ragRetrieval";
import {
  applyStructuredPlanDaySuggestionRows,
  isUnscopedStructuredReplace,
  parseStructuredPlanDaySuggestionRows,
  structuredReplaceTextUpdates,
  withReplacedPrescription,
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
  // Notes too: returning "" here made every "append" to notes REPLACE the
  // day's existing notes with the coach's line. The manual apply path
  // (aiSuggestionService getPlanDayFieldValue) already read them.
  return entry.notes || "";
}

function buildUpdateValue(suggestion: WorkoutSuggestion, entry: UpcomingWorkout): string {
  if (suggestion.action !== "append") return suggestion.recommendation;
  const existing = getExistingFieldValue(suggestion, entry);
  // Auto-coach re-runs on every sync, so a plain append stacked the same cue
  // (notably the load governor's) once per run. appendCoachCue dedupes and
  // keeps one cue per line after the athlete's own text.
  if (suggestion.targetField === "notes") {
    return appendCoachCue(existing, suggestion.recommendation);
  }
  return appendCoachBlock(existing, suggestion.recommendation);
}

/**
 * Preserve the day's own coach state across coach-note rewrites.
 * `aiInputsUsed` is rebuilt from scratch on every coach run (and by review
 * notes / manual refreshes), so without this the next write to a day wiped:
 *   - the "Originally planned" record captured when the day was converted;
 *   - lastFatigueReduction / lastModification, which the repeat-fatigue guard
 *     reads. A suppressed repeat cut gets a review note, so the guard erased
 *     its own record and the pass after that cut the day again.
 *     AI15 (CODEBASE_ANALYSIS_2026-10-03)
 * Each is carried forward only when the fresh inputs don't set one — a genuine
 * new conversion or modification always wins. The plan adaptation's
 * buildInputs carries the same state.
 */
function carryPriorCoachState(
  next: CoachNoteInputs,
  prior: CoachNoteInputs | null | undefined,
): CoachNoteInputs {
  if (!prior) return next;
  return {
    ...next,
    ...(!next.replacedPrescription && prior.replacedPrescription
      ? { replacedPrescription: prior.replacedPrescription }
      : {}),
    ...(!next.lastModification && prior.lastModification
      ? { lastModification: prior.lastModification }
      : {}),
    ...(!next.lastFatigueReduction && prior.lastFatigueReduction
      ? { lastFatigueReduction: prior.lastFatigueReduction }
      : {}),
  };
}

interface PreparedSuggestion {
  readonly suggestion: WorkoutSuggestion;
  readonly structuredSetRows?: InsertExerciseSet[];
  readonly aiSourceOverride?: Exclude<AutoCoachAiSource, undefined>;
  readonly requiresStructuredWrite?: boolean;
  readonly rationaleCode?: string;
  readonly focusOverride?: string;
  /** A governor day already downshifted: claimed for this pass, never written. */
  readonly held?: boolean;
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
  /** The suggestions call failed: the model evaluated no day (AI8). */
  readonly suggestionsFailed: boolean;
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
  /** The workout engine's adaptation of the plan to the latest logs, if any. */
  readonly adaptation?: PlanAdaptation | null;
}

function hasStructuredExercises(entry: UpcomingWorkout | undefined): boolean {
  return Boolean(entry?.exerciseDetails && entry.exerciseDetails.length > 0);
}

/**
 * An accessory-only "replace" on a table-backed day is refused: the table
 * can't be scoped to the accessory rows, so writing it would delete the main
 * work too. The day falls through to the review-note pass instead.
 * AI13 (CODEBASE_ANALYSIS_2026-10-03)
 */
function isRefusedStructuredReplace(
  suggestion: WorkoutSuggestion,
  entry: UpcomingWorkout | undefined,
): boolean {
  if (!hasStructuredExercises(entry) || !isUnscopedStructuredReplace(suggestion)) return false;
  // An internal plan-day id only, no workout content.
  // bearer:disable javascript_lang_logger_leak
  logger.info(
    { workoutId: suggestion.workoutId },
    "[coach] Accessory-only replace refused on a table-backed day; reviewing the day instead",
  );
  return true;
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
    held: suggestion.held,
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
    Object.assign(updates, structuredReplaceTextUpdates(suggestion.recommendation, unitPreferences));

    // Only the governor supplies a new title, and we rename only when it
    // actually changes the title. A repeat coach pass on an already-converted
    // day sees the same title and skips.
    const newFocus = focusOverride?.trim();
    const retitled = Boolean(
      newFocus && newFocus.toLowerCase() !== entry.focus.trim().toLowerCase(),
    );
    if (retitled) updates.focus = newFocus;
    // What the replace swapped out — the athlete's text included — is kept as
    // "Originally planned": always on a retitling conversion, otherwise only
    // the first time, so the coach's own earlier version (a recovery run, a
    // trimmed table) is never recorded as the original. Every structured
    // replace records it, not just a governor conversion.
    // AI13 (CODEBASE_ANALYSIS_2026-10-03)
    suggestionInputs = withReplacedPrescription(suggestionInputs, entry, retitled);
  }

  suggestionInputs = carryPriorCoachState(suggestionInputs, entry.aiInputsUsed);
  updates.aiInputsUsed = suggestionInputs;

  await storage.plans.updatePlanDay(suggestion.workoutId, updates, userId, tx);
  return { applied: true, inputsUsed: suggestionInputs };
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
  // A held governor day is claimed for the pass but never rewritten.
  // AI14 (CODEBASE_ANALYSIS_2026-10-03)
  if (prepared.held) return { applied: false };
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
  const suggestionInputs = carryPriorCoachState(
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
      // A review note must not erase the day's "Originally planned" record or
      // the fatigue-reduction record the repeat guard reads (AI15).
      aiInputsUsed: carryPriorCoachState(inputsUsed, priorInputs),
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
      priority: w.priority,
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
  suggestionsFailed,
}: ReviewNotesInput): Promise<ReviewNote[]> {
  if (unchangedWorkouts.length === 0) return [];
  if (forcedSafetyNote) {
    return unchangedWorkouts.map((workout) => ({
      workoutId: workout.id,
      note: forcedSafetyNote,
    }));
  }
  // A review note says why the coach left a day alone. When the suggestions
  // call failed nothing was weighed, so no "the plan still fits" note is
  // written; the safety note above needs no model and still goes (AI8).
  if (suggestionsFailed) return [];
  return generateReviewNotes(
    trainingContext,
    unchangedWorkouts,
    activePlanGoal,
    coachingText,
    userId,
    stylePromptContext,
  );
}

/**
 * One of the model's calls, its failure held in `failures` rather than thrown,
 * so the pass still writes what needs no model — the load governor, the plan
 * adaptation, a safety note — before it fails the job for pg-boss to retry.
 * The suggestion service no longer turns a failure into `[]`, which read as
 * "nothing to change" and wrote "the plan still fits" notes during an outage.
 * AI8 (CODEBASE_ANALYSIS_2026-10-03)
 */
async function attemptModelCall<T>(call: () => Promise<T[]>, failures: unknown[]): Promise<T[]> {
  try {
    return await call();
  } catch (error) {
    failures.push(error);
    return [];
  }
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

/** The snapshots of the upcoming days this pass writes a change or a note to. */
function collectWriteTargets(
  preparedSuggestions: PreparedSuggestion[],
  reviewNotes: ReviewNote[],
  upcomingWorkouts: UpcomingWorkout[],
): UpcomingWorkout[] {
  const ids = new Set([
    ...preparedSuggestions
      .filter((prepared) => !prepared.held)
      .map((prepared) => prepared.suggestion.workoutId),
    ...reviewNotes.map((note) => note.workoutId),
  ]);
  return upcomingWorkouts.filter((workout) => ids.has(workout.id));
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
  adaptation,
}: AutoCoachApplyInput): Promise<{ adjusted: number; noted: number }> {
  return await db.transaction(async (tx) => {
    // Everything below was computed from a snapshot taken before the model
    // calls. Serialize the athlete's passes, and leave alone every day (and
    // the whole adaptation) that changed since. AI16 (CODEBASE_ANALYSIS_2026-10-03)
    const stale = await lockAutoCoachWriteTargets(tx, userId, {
      days: collectWriteTargets(preparedSuggestions, reviewNotes, upcomingWorkouts),
      adaptation: adaptation ?? null,
    });
    const isCurrent = (workoutId: string) => !stale.dayIds.has(workoutId);

    const inputsByWorkoutId = new Map<string, CoachNoteInputs>();
    const currentSuggestions = preparedSuggestions.filter((prepared) =>
      isCurrent(prepared.suggestion.workoutId),
    );
    // Keep duplicate suggestions for the same plan day ordered so structured
    // appends re-read sortOrder after any earlier insert in this transaction.
    const modResults = await inSequence(currentSuggestions, async (prepared) => {
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
      if (result.applied && result.inputsUsed) {
        inputsByWorkoutId.set(prepared.suggestion.workoutId, result.inputsUsed);
      }
      return result;
    });
    const workoutById = new Map(upcomingWorkouts.map((workout) => [workout.id, workout]));
    const noteResults = await Promise.all(
      reviewNotes.filter((note) => isCurrent(note.workoutId)).map((note) =>
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

    // The engine's days never overlap the ones above: the governor's days are
    // excluded from the adaptation, and the adaptation's from the model's pass.
    let adjustedCount = await applyPlanAdaptation(
      stale.adaptation ? null : (adaptation ?? null),
      userId,
      tx,
    );
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

interface DeterministicStages {
  readonly loadGovernorPrepared: PreparedSuggestion[];
  /** Days the governor or the adaptation will rewrite: the model's pass leaves them alone. */
  readonly modifiedIds: Set<string>;
  readonly adaptation: PlanAdaptation | null;
}

/**
 * The coach's rule-based stages, in precedence order: the load governor
 * (fatigue and workload), then the workout engine's adaptation of the plan to
 * the athlete's latest logs — which skips any day the governor rewrote. Both
 * are free and deterministic, so they run whether or not the model does.
 */
async function prepareDeterministicStages(
  userId: string,
  trainingContext: TrainingContext,
  upcomingWorkouts: UpcomingWorkout[],
  unitPreferences: UnitPreferences,
): Promise<DeterministicStages> {
  const loadGovernorPrepared = trainingContext.coachingInsights?.loadGovernor
    ? buildLoadGovernorSuggestions(
        trainingContext.coachingInsights.loadGovernor,
        upcomingWorkouts,
        trainingContext.currentDate,
      ).map(prepareLoadGovernorSuggestion)
    : [];
  const loadGovernorModifiedIds = collectModifiedWorkoutIds(
    loadGovernorPrepared.map((prepared) => prepared.suggestion),
    upcomingWorkouts,
  );
  const adaptation = await computePlanAdaptation(
    userId,
    trainingContext,
    unitPreferences,
    loadGovernorModifiedIds,
  );
  return {
    loadGovernorPrepared,
    modifiedIds: new Set([...loadGovernorModifiedIds, ...adaptedDayIds(adaptation)]),
    adaptation,
  };
}

function hasDeterministicWork(stages: DeterministicStages): boolean {
  return (
    stages.loadGovernorPrepared.some((prepared) => !prepared.held) || stages.adaptation != null
  );
}

/** Apply only the rule-based stages: no model call, no review notes. */
async function applyDeterministicStagesOnly(
  stages: DeterministicStages,
  context: {
    readonly userId: string;
    readonly trainingContext: TrainingContext;
    readonly upcomingWorkouts: UpcomingWorkout[];
    readonly unitPreferences: UnitPreferences;
    readonly activePlanGoal: string | undefined;
  },
): Promise<{ adjusted: number }> {
  if (!hasDeterministicWork(stages)) return { adjusted: 0 };
  const { adjusted } = await applyAutoCoachChanges({
    preparedSuggestions: stages.loadGovernorPrepared,
    upcomingWorkouts: context.upcomingWorkouts,
    userId: context.userId,
    aiSource: null,
    inputsUsed: buildCoachNoteInputs(context.trainingContext, false, Boolean(context.activePlanGoal)),
    coachSignals: buildSignalsFromTrainingContext(context.trainingContext),
    unitPreferences: context.unitPreferences,
    reviewNotes: [],
    adaptation: stages.adaptation,
  });
  return { adjusted };
}

/**
 * Auto-coach: fires after a workout is completed.
 * Reads the user's active plan goal + recent performance, then applies AI-suggested
 * adjustments directly to upcoming plan_days. Throws on failure so the
 * auto-coach job is retried — including a failed model call, after the
 * rule-based stages are written (AI8).
 */
export async function triggerAutoCoach(userId: string): Promise<{ adjusted: number }> {
  try {
    const user = await storage.users.getUser(userId);
    if (!user?.aiCoachEnabled) return { adjusted: 0 };

    // The budget gates the MODEL's pass only. The load governor and the plan
    // adaptation below cost nothing, so an athlete over their AI budget still
    // gets their plan moved to what they logged.
    const budget = await checkAiBudget(userId);

    await storage.users.updateIsAutoCoaching(userId, true);

    // buildTrainingContext already fetches the active plan, upcoming
    // planned days, and recent timeline — reuse its results instead of
    // issuing duplicate getTimeline + getActivePlan calls.
    const trainingContext = await buildTrainingContext(userId);

    const activePlanGoal = trainingContext.activePlan?.goal ?? undefined;

    const upcomingWorkouts = buildUpcomingWorkoutInputs(trainingContext);

    const unitPreferences = {
      weightUnit: user.weightUnit || "kg",
      distanceUnit: user.distanceUnit || "km",
    };
    const stages = await prepareDeterministicStages(
      userId,
      trainingContext,
      upcomingWorkouts,
      unitPreferences,
    );
    const deterministicContext = {
      userId,
      trainingContext,
      upcomingWorkouts,
      unitPreferences,
      activePlanGoal,
    };

    if (!budget.allowed) {
      logger.info("[coach] AI budget exceeded — applying rule-based stages only");
      return await applyDeterministicStagesOnly(stages, deterministicContext);
    }

    if (upcomingWorkouts.length === 0) {
      // Legitimate no-op for the model: user has no active plan or the plan has
      // no planned days this week. Log so support can distinguish this from an
      // AI/API failure (W3). The adaptation may still reach days further out.
      logger.info(
        { userId, planName: trainingContext.activePlan?.name },
        "[coach] Auto-coach skipped — no upcoming planned workouts",
      );
      return await applyDeterministicStagesOnly(stages, deterministicContext);
    }

    const resolvedStyle = resolveTrainingStyle(user.trainingStyleId);
    const stylePromptContext = resolvedStyle.strategy.buildPromptContext(
      trainingContext,
      upcomingWorkouts,
    );

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

    const failures: unknown[] = [];
    const rawSuggestions = await attemptModelCall(
      () =>
        generateWorkoutSuggestions(
          trainingContext,
          upcomingWorkouts,
          activePlanGoal,
          coachingContext.text,
          userId,
          stylePromptContext,
        ),
      failures,
    );
    const safetyAdjustedSuggestions = applySafetyLayerToSuggestions(rawSuggestions, safetySignals);
    const workoutMap = new Map(upcomingWorkouts.map((w) => [w.id, w]));
    const coachSignals = buildSignalsFromTrainingContext(trainingContext);
    // The model never rewrites a day a rule-based stage already changed: the
    // governor's fatigue edits and the engine's log-driven loads come from the
    // athlete's own data, and a generic rewrite would silently undo them.
    const suggestions = safetyAdjustedSuggestions.filter(
      (suggestion) =>
        !stages.modifiedIds.has(suggestion.workoutId) &&
        !isRefusedStructuredReplace(suggestion, workoutMap.get(suggestion.workoutId)) &&
        !shouldSuppressRepeatedFatigueReduction(
          suggestion,
          workoutMap.get(suggestion.workoutId),
          coachSignals,
        ),
    );
    const preparedSuggestions = await Promise.all(
      suggestions.map((s) => prepareSuggestion(s, upcomingWorkouts, unitPreferences, userId)),
    );
    const allPreparedSuggestions = [...stages.loadGovernorPrepared, ...preparedSuggestions];

    // For any upcoming day the coach did NOT modify, request a short review
    // note so the athlete can still see the coach's thinking on that day.
    // Without this, "no suggestions" looks identical to "coach never ran".
    //
    // Build the modified set from suggestions that actually pass the
    // apply-time validation, not from every model output. A malformed
    // suggestion (missing workoutId/recommendation, or targeting an id
    // not in the upcoming slate) would otherwise be dropped in both the
    // modification pass AND the review-note pass, leaving that day with
    // no note at all (C-NOTE-1). Days the adaptation changed carry the
    // engine's own note, so they are "modified" too.
    const modifiedIds = new Set([
      ...collectModifiedWorkoutIds(
        allPreparedSuggestions.map((prepared) => prepared.suggestion),
        upcomingWorkouts,
      ),
      ...adaptedDayIds(stages.adaptation),
    ]);

    const unchanged = selectUnchangedWorkouts(upcomingWorkouts, modifiedIds);

    const forcedSafetyNote = buildSafetyReviewNote(safetySignals);
    const suggestionsFailed = failures.length > 0;
    const rawReviewNotes = await attemptModelCall(
      () =>
        buildReviewNotes({
          trainingContext,
          unchangedWorkouts: unchanged.workouts,
          activePlanGoal,
          coachingText: coachingContext.text,
          userId,
          stylePromptContext,
          forcedSafetyNote,
          suggestionsFailed,
        }),
      failures,
    );
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
      adaptation: stages.adaptation,
    });

    if (adjusted > 0 || noted > 0) {
      logger.info({ userId, adjusted, noted }, "[coach] Auto-coach applied adjustments and notes");
    }
    if (failures.length > 0) {
      // Fail the job so pg-boss retries the model's pass (AI8).
      logger.warn({ adjusted, noted }, "[coach] A model call failed; wrote what needs no model, retrying");
      throw failures[0];
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
  // ⚡ Bolt Performance Optimization:
  // `user` (users table) and `day` (plan_days joined to training_plans) are
  // independent reads with no data dependency between them — `user` isn't
  // consulted until resolveTrainingStyle() much further down. Fetching them
  // concurrently halves this handler's DB round-trip latency on every call.
  const [user, day] = await Promise.all([
    storage.users.getUser(userId),
    storage.plans.getPlanDay(planDayId, userId),
  ]);
  if (!day) {
    throw new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404);
  }

  // Cooldown: if the note was just regenerated, bounce the caller with a
  // retry-after hint. Uses aiNoteUpdatedAt as the canonical "last refresh"
  // timestamp — auto-coach writes it on its own apply path, so a manual
  // refresh can't immediately follow an auto-coach regeneration either.
  if (day.aiNoteUpdatedAt) {
    // ⚡ Bolt Performance Optimization:
    // Avoid redundant new Date() allocation since Drizzle already provides a Date object
    // for timestamp fields. This eliminates unnecessary garbage collection overhead.
    const elapsed = Date.now() - day.aiNoteUpdatedAt.getTime();
    if (elapsed < REGENERATE_COOLDOWN_MS) {
      return { retryAfterMs: REGENERATE_COOLDOWN_MS - elapsed };
    }
  }

  const trainingContext = await buildTrainingContext(userId);
  const activePlanGoal = trainingContext.activePlan?.goal ?? undefined;
  const planDaySets = await storage.workouts.getExerciseSetsByPlanDay(day.id, userId);

  const workoutInput: UpcomingWorkout = {
    id: day.id,
    // Reached only when a plan day has no scheduled date, where there is no
    // athlete-local day to place it on either; the value is a label for the
    // prompt, not a window bound.
    // eslint-disable-next-line no-restricted-syntax
    date: day.scheduledDate ?? new Date().toISOString().slice(0, 10),
    focus: day.focus,
    mainWorkout: day.mainWorkout,
    accessory: planDaySets && planDaySets.length > 0 ? undefined : day.accessory || undefined,
    notes: planDaySets && planDaySets.length > 0 ? undefined : day.notes || undefined,
    exerciseDetails: (planDaySets ?? []).map(mapExerciseSetToPromptDetail),
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
      aiInputsUsed: carryPriorCoachState(inputsUsed, day.aiInputsUsed),
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
