import {
  type ChatMessage,
  type CoachNoteInputs,
  type EnrichedPlanAdjustmentChange,
  type ExerciseSet,
  exerciseSets,
  type PlanAdjustmentBaseline,
  type PlanAdjustmentChange,
  type PlanAdjustmentChangeKind,
  type PlanAdjustmentProposal,
  type PlanAdjustmentUpdatedFields,
  type PlanDay,
  type UpdatePlanDay,
} from "@shared/schema";
import { normalizeWorkoutTextUnits, type UnitPreferences } from "@shared/unitConversion";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";

import { db } from "../db";
import { generatePlanAdjustment } from "../gemini/planAdjustmentService";
import type { UpcomingWorkout } from "../gemini/suggestionService";
import { logger as defaultLogger } from "../logger";
import { storage } from "../storage";
import type { UpcomingPlannedDay } from "../storage/timeline";
import type { AIContext } from "./aiContextService";
import { extractCoachingMaterialsText } from "./aiContextService";
import {
  buildSignalsFromCoachInputs,
  buildWorkoutPrescriptionFingerprint,
  mapExerciseSetToPromptDetail,
  withCoachModificationMetadata,
} from "./aiModificationGuard";
import { analyzeSafetySignals, buildSafetyReviewNote } from "./aiSafety";
import { getStructuredApplyBlocker } from "./aiSuggestionService";
import {
  applyStructuredPlanDaySuggestionRows,
  parseStructuredPlanDaySuggestionRows,
} from "./structuredPlanDaySuggestion";

type PlanAdjustmentLogger = Pick<Logger, "info" | "warn" | "error">;

/** How many upcoming planned days the coach may see and touch (~4 weeks). */
const UPCOMING_DAY_WINDOW = 28;

export type PlanAdjustmentProposalResult =
  | { kind: "proposal"; proposal: PlanAdjustmentProposal }
  /** The coach replies conversationally without proposing changes. */
  | { kind: "chat_fallback"; text: string }
  /** Generation itself failed — the caller should fall back to normal chat. */
  | { kind: "generation_failed" };

export type ApplyPlanProposalFailureReason =
  | "not_pending"
  | "stale"
  | "structured_parse_failed"
  | "ai_budget_exceeded"
  | "ai_disabled";

export type ApplyPlanProposalResult =
  | { applied: true; changeCount: number }
  | {
      applied: false;
      reason: ApplyPlanProposalFailureReason;
      message: string;
      staleChanges?: Array<{ planDayId: string; dayLabel: string }>;
    };

const NO_PLAN_FALLBACK_TEXT =
  "You have no upcoming planned workouts for me to adjust. Start or schedule a plan and I can rearrange days for you.";

function toUpcomingWorkout(day: UpcomingPlannedDay): UpcomingWorkout {
  return {
    id: day.planDayId,
    date: day.date,
    focus: day.focus,
    mainWorkout: day.mainWorkout,
    accessory: day.accessory || undefined,
    notes: day.notes || undefined,
    aiSource: day.aiSource,
    aiRationale: day.aiRationale,
    aiNoteUpdatedAt: day.aiNoteUpdatedAt,
    aiInputsUsed: day.aiInputsUsed,
    ...(day.exerciseSets.length > 0
      ? { exerciseDetails: day.exerciseSets.map(mapExerciseSetToPromptDetail) }
      : {}),
  };
}

/** Fields structure-block (EMOM/AMRAP) days must never receive from this flow. */
const STRUCTURE_BLOCK_FORBIDDEN_FIELDS = ["focus", "mainWorkout", "accessory"] as const;

function stripForbiddenStructureBlockFields(
  fields: PlanAdjustmentUpdatedFields,
): PlanAdjustmentUpdatedFields {
  const cleaned = { ...fields };
  for (const field of STRUCTURE_BLOCK_FORBIDDEN_FIELDS) {
    delete cleaned[field];
  }
  return cleaned;
}

function hasAnyField(fields: PlanAdjustmentUpdatedFields): boolean {
  return Object.values(fields).some((value) => value !== undefined);
}

const REST_FOCUS_PATTERN = /\brest\b/i;
const REST_WORKOUT_PATTERN = /\b(?:complete rest|rest day|full rest)\b/i;

export function derivePlanAdjustmentChangeKind(
  fields: PlanAdjustmentUpdatedFields,
): PlanAdjustmentChangeKind {
  const prescriptionChanged =
    fields.mainWorkout !== undefined || fields.accessory !== undefined || fields.focus !== undefined;
  if (prescriptionChanged) {
    const isRest =
      (fields.focus != null && REST_FOCUS_PATTERN.test(fields.focus)) ||
      (fields.mainWorkout != null && REST_WORKOUT_PATTERN.test(fields.mainWorkout));
    return isRest ? "rest_conversion" : "workout_update";
  }
  if (fields.scheduledDate !== undefined) return "reschedule";
  return "tune";
}

function formatDayLabel(scheduledDate: string | null, focus: string): string {
  if (!scheduledDate) return focus;
  const date = new Date(`${scheduledDate}T00:00:00Z`);
  const formatted = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return focus ? `${formatted} — ${focus}` : formatted;
}

function buildBaseline(day: PlanDay, sets: ExerciseSet[]): PlanAdjustmentBaseline {
  return {
    focus: day.focus,
    mainWorkout: day.mainWorkout,
    accessory: day.accessory,
    notes: day.notes,
    scheduledDate: day.scheduledDate,
    expectedDurationMin: day.expectedDurationMin,
    expectedRpe: day.expectedRpe,
    status: day.status ?? "planned",
    fingerprint: buildWorkoutPrescriptionFingerprint({
      mainWorkout: day.mainWorkout,
      accessory: day.accessory ?? undefined,
      notes: day.notes ?? undefined,
      exerciseDetails: sets.map(mapExerciseSetToPromptDetail),
    }),
  };
}

function normalizeProposalAiSource(source: "rag" | "legacy" | "none"): string | null {
  return source === "rag" || source === "legacy" ? source : null;
}

export interface CreatePlanAdjustmentProposalInput {
  userId: string;
  message: string;
  history: Pick<ChatMessage, "role" | "content">[];
  aiContext: AIContext;
  /** Day the athlete is viewing when chatting from the workout-detail dialog. */
  focusPlanDayId?: string;
}

export async function createPlanAdjustmentProposal(
  input: CreatePlanAdjustmentProposalInput,
  log: PlanAdjustmentLogger = defaultLogger,
): Promise<PlanAdjustmentProposalResult> {
  const { userId, message, history, aiContext } = input;

  const plannedDays = await storage.timeline.getUpcomingPlannedDays(userId, UPCOMING_DAY_WINDOW);
  if (plannedDays.length === 0) {
    return { kind: "chat_fallback", text: NO_PLAN_FALLBACK_TEXT };
  }

  const upcomingWorkouts = plannedDays.map(toUpcomingWorkout);
  const offeredDayIds = new Set(upcomingWorkouts.map((w) => w.id));
  const structureBlockDayIds = new Set(
    plannedDays
      .filter((day) => (day.structureBlocks?.length ?? 0) > 0)
      .map((day) => day.planDayId),
  );

  // Red-flag symptoms in the athlete's data mean no AI plan modification at
  // all — reply with the safety escalation instead (same policy as the
  // suggestions pipeline).
  const safetySignals = analyzeSafetySignals(aiContext.trainingContext, upcomingWorkouts);
  if (safetySignals.redFlagDetected) {
    const note = buildSafetyReviewNote(safetySignals);
    return { kind: "chat_fallback", text: note ?? NO_PLAN_FALLBACK_TEXT };
  }

  let llmOutput;
  try {
    llmOutput = await generatePlanAdjustment({
      trainingContext: aiContext.trainingContext,
      upcomingWorkouts,
      structureBlockDayIds,
      userMessage: message,
      history,
      planGoal: aiContext.trainingContext.activePlan?.goal ?? undefined,
      coachingMaterials: extractCoachingMaterialsText(aiContext),
      focusPlanDayId: input.focusPlanDayId,
      userId,
    });
  } catch (error) {
    // bearer:disable javascript_lang_logger_leak — err is an AI provider
    // error and userId is an internal identifier; no message content.
    log.error({ err: error, userId }, "[plan-adjustment] Generation failed");
    return { kind: "generation_failed" };
  }
  if (!llmOutput) {
    return { kind: "generation_failed" };
  }

  // Server-side clamps — the LLM's output is untrusted:
  // hallucinated/stale day IDs are dropped, and structure-block days lose
  // any prescription rewrite (schedule/notes/expected* survive).
  const clampedChanges: PlanAdjustmentChange[] = [];
  for (const change of llmOutput.changes) {
    if (!offeredDayIds.has(change.planDayId)) {
      // bearer:disable javascript_lang_logger_leak — internal identifiers
      // only (user id, plan-day id), no message or workout content.
      log.warn(
        { userId, planDayId: change.planDayId },
        "[plan-adjustment] Dropping change for day outside the offered set",
      );
      continue;
    }
    let fields = change.updatedFields;
    if (structureBlockDayIds.has(change.planDayId)) {
      fields = stripForbiddenStructureBlockFields(fields);
      if (!hasAnyField(fields)) {
        // bearer:disable javascript_lang_logger_leak — internal identifiers
        // only (user id, plan-day id), no message or workout content.
        log.warn(
          { userId, planDayId: change.planDayId },
          "[plan-adjustment] Dropping structure-block change with only forbidden fields",
        );
        continue;
      }
    }
    clampedChanges.push({ ...change, updatedFields: fields });
  }

  if (clampedChanges.length === 0) {
    // Either the coach declined / asked a clarifying question (legitimate
    // empty proposal) or every change was clamped away — both read best as
    // a plain conversational reply.
    return { kind: "chat_fallback", text: llmOutput.summaryMessage };
  }

  // Enrich against the RAW plan-day rows (not the race-day-overridden
  // timeline view) so baselines and fingerprints match what the apply step
  // will re-read.
  const enriched: EnrichedPlanAdjustmentChange[] = [];
  let planId: string | null = null;
  for (const change of clampedChanges) {
    const [day, sets] = await Promise.all([
      storage.plans.getPlanDay(change.planDayId, userId),
      storage.workouts.getExerciseSetsByPlanDay(change.planDayId, userId),
    ]);
    if (!day || sets === null || day.status !== "planned") {
      // bearer:disable javascript_lang_logger_leak — internal identifiers
      // only (user id, plan-day id), no message or workout content.
      log.warn(
        { userId, planDayId: change.planDayId },
        "[plan-adjustment] Dropping change whose day vanished or is no longer planned",
      );
      continue;
    }
    planId ??= day.planId;
    enriched.push({
      ...change,
      kind: derivePlanAdjustmentChangeKind(change.updatedFields),
      dayLabel: formatDayLabel(day.scheduledDate, day.focus),
      baseline: buildBaseline(day, sets),
      structured: sets.length > 0,
      hasStructureBlocks: structureBlockDayIds.has(change.planDayId),
    });
  }

  if (enriched.length === 0 || planId === null) {
    return { kind: "chat_fallback", text: llmOutput.summaryMessage };
  }

  const proposal = await storage.planProposals.create({
    userId,
    planId,
    summaryMessage: llmOutput.summaryMessage,
    userRequest: message,
    payload: { changes: enriched },
    aiSource: normalizeProposalAiSource(aiContext.ragInfo.source),
  });

  // bearer:disable javascript_lang_logger_leak — internal identifiers and a
  // count only, no message or workout content.
  log.info(
    { userId, proposalId: proposal.id, changeCount: enriched.length },
    "[plan-adjustment] Proposal created",
  );
  return { kind: "proposal", proposal };
}

const APPLY_FAILURE_MESSAGES: Record<ApplyPlanProposalFailureReason, string> = {
  not_pending: "That proposal was already applied, dismissed, or replaced by a newer one.",
  stale:
    "Your plan changed since I proposed this, so I didn't apply anything. Ask me again and I'll work from the latest plan.",
  structured_parse_failed:
    "I couldn't convert part of that proposal into exercise-table rows, so I left your plan unchanged. You can try applying it again.",
  ai_budget_exceeded:
    "Applying this needs one more AI parse for a table-backed workout, but your daily AI limit has been reached. Your plan is unchanged.",
  ai_disabled:
    "Applying this needs one more AI parse for a table-backed workout, but AI features are temporarily disabled. Your plan is unchanged.",
};

function applyFailure(
  reason: ApplyPlanProposalFailureReason,
  staleChanges?: Array<{ planDayId: string; dayLabel: string }>,
): ApplyPlanProposalResult {
  return {
    applied: false,
    reason,
    message: APPLY_FAILURE_MESSAGES[reason],
    ...(staleChanges && staleChanges.length > 0 ? { staleChanges } : {}),
  };
}

/** True when the change rewrites the prescription of a table-backed day. */
function needsStructuredReparse(change: EnrichedPlanAdjustmentChange): boolean {
  return (
    change.structured &&
    change.kind !== "rest_conversion" &&
    (change.updatedFields.mainWorkout !== undefined ||
      change.updatedFields.accessory !== undefined)
  );
}

function buildStructuredParseText(
  change: EnrichedPlanAdjustmentChange,
  day: PlanDay,
): string {
  // The exercise table represents the day's full prescription, so the
  // re-parse input must combine the (possibly unchanged) main work and
  // accessory rather than only the field that changed.
  const mainWorkout = change.updatedFields.mainWorkout ?? day.mainWorkout;
  const accessory =
    change.updatedFields.accessory === undefined
      ? day.accessory
      : change.updatedFields.accessory;
  return [mainWorkout, accessory].filter(Boolean).join("\n");
}

function buildUpdatePlanDayPayload(
  change: EnrichedPlanAdjustmentChange,
  day: PlanDay,
  aiSource: string | null,
  unitPreferences: UnitPreferences,
): UpdatePlanDay {
  const fields = change.updatedFields;
  const updates: UpdatePlanDay = {};

  if (!change.structured) {
    // Free-text days: the text fields ARE the prescription.
    if (fields.mainWorkout !== undefined) {
      updates.mainWorkout =
        normalizeWorkoutTextUnits(fields.mainWorkout, unitPreferences) ?? fields.mainWorkout;
    }
    if (fields.accessory !== undefined) {
      updates.accessory =
        fields.accessory === null
          ? null
          : (normalizeWorkoutTextUnits(fields.accessory, unitPreferences) ?? fields.accessory);
    }
  } else if (change.kind === "rest_conversion") {
    // Rest conversion clears the table (below) and rewrites the text fields
    // so the day reads as rest everywhere.
    if (fields.mainWorkout !== undefined) updates.mainWorkout = fields.mainWorkout;
    if (fields.accessory !== undefined) updates.accessory = fields.accessory;
  }
  // Structured (table-backed) prescription rewrites deliberately do NOT
  // touch mainWorkout/accessory text — the exercise table is the source of
  // truth there, matching applyTimelineAiSuggestion's behavior.

  if (fields.focus !== undefined) updates.focus = fields.focus;
  if (fields.notes !== undefined) updates.notes = fields.notes;
  if (fields.scheduledDate !== undefined) updates.scheduledDate = fields.scheduledDate;
  if (fields.expectedDurationMin !== undefined) {
    updates.expectedDurationMin = fields.expectedDurationMin;
  }
  if (fields.expectedRpe !== undefined) updates.expectedRpe = fields.expectedRpe;

  const baseInputsUsed: CoachNoteInputs = { ...day.aiInputsUsed };
  const primaryField =
    fields.mainWorkout !== undefined
      ? ("mainWorkout" as const)
      : fields.accessory !== undefined
        ? ("accessory" as const)
        : ("notes" as const);
  const recommendation =
    primaryField === "mainWorkout"
      ? (fields.mainWorkout ?? "")
      : primaryField === "accessory"
        ? (fields.accessory ?? "")
        : (fields.notes ?? "");

  updates.aiSource = aiSource === "rag" || aiSource === "legacy" ? aiSource : null;
  updates.aiRationale = change.rationale.slice(0, 400);
  updates.aiNoteUpdatedAt = new Date();
  updates.aiInputsUsed = withCoachModificationMetadata(
    baseInputsUsed,
    {
      workoutId: change.planDayId,
      targetField: primaryField,
      action: "replace",
      recommendation,
      rationale: change.rationale,
    },
    buildSignalsFromCoachInputs(baseInputsUsed),
    {
      mainWorkout: fields.mainWorkout ?? day.mainWorkout,
      accessory: (fields.accessory === undefined ? day.accessory : fields.accessory) ?? undefined,
      notes: (fields.notes === undefined ? day.notes : fields.notes) ?? undefined,
    },
  );

  return updates;
}

export async function applyPlanAdjustmentProposal(
  userId: string,
  proposalId: string,
  log: PlanAdjustmentLogger = defaultLogger,
): Promise<ApplyPlanProposalResult | undefined> {
  const proposal = await storage.planProposals.getById(proposalId, userId);
  if (!proposal) return undefined;
  if (proposal.status !== "pending") return applyFailure("not_pending");

  const changes = proposal.payload.changes;

  // Revalidate every change against the live plan. Multi-day rebalances are
  // coherent units, so this apply is ALL-OR-NOTHING: any stale day
  // invalidates the whole proposal rather than applying a nonsense subset.
  const liveDays = new Map<string, { day: PlanDay; sets: ExerciseSet[] }>();
  const staleChanges: Array<{ planDayId: string; dayLabel: string }> = [];
  for (const change of changes) {
    const [day, sets] = await Promise.all([
      storage.plans.getPlanDay(change.planDayId, userId),
      storage.workouts.getExerciseSetsByPlanDay(change.planDayId, userId),
    ]);
    const currentFingerprint =
      day && sets !== null
        ? buildWorkoutPrescriptionFingerprint({
            mainWorkout: day.mainWorkout,
            accessory: day.accessory ?? undefined,
            notes: day.notes ?? undefined,
            exerciseDetails: sets.map(mapExerciseSetToPromptDetail),
          })
        : undefined;
    if (
      !day ||
      sets === null ||
      day.status !== "planned" ||
      currentFingerprint !== change.baseline.fingerprint
    ) {
      staleChanges.push({ planDayId: change.planDayId, dayLabel: change.dayLabel });
      continue;
    }
    liveDays.set(change.planDayId, { day, sets });
  }

  if (staleChanges.length > 0) {
    await storage.planProposals.resolve(proposalId, userId, "invalidated");
    // bearer:disable javascript_lang_logger_leak — internal identifiers and a
    // count only, no message or workout content.
    log.info(
      { userId, proposalId, staleCount: staleChanges.length },
      "[plan-adjustment] Proposal invalidated by stale days at apply time",
    );
    return applyFailure("stale", staleChanges);
  }

  const user = await storage.users.getUser(userId);
  const unitPreferences: UnitPreferences = {
    weightUnit: user?.weightUnit || "kg",
    distanceUnit: user?.distanceUnit || "km",
  };

  // Structured re-parses happen BEFORE the transaction opens — never hold a
  // DB transaction across AI calls (same ordering as applyTimelineAiSuggestion).
  const structuredChanges = changes.filter(needsStructuredReparse);
  if (structuredChanges.length > 0) {
    const blocker = await getStructuredApplyBlocker(userId, log);
    if (blocker) return applyFailure(blocker.reason);
  }

  const structuredRowsByDayId = new Map<string, Awaited<ReturnType<typeof parseStructuredPlanDaySuggestionRows>>>();
  for (const change of structuredChanges) {
    const live = liveDays.get(change.planDayId);
    if (!live) continue;
    try {
      const rows = await parseStructuredPlanDaySuggestionRows(
        {
          workoutId: change.planDayId,
          recommendation: buildStructuredParseText(change, live.day),
        },
        unitPreferences,
        userId,
      );
      if (rows.length === 0) {
        // bearer:disable javascript_lang_logger_leak — internal identifiers
        // only, no message or workout content.
        log.warn(
          { userId, proposalId, planDayId: change.planDayId },
          "[plan-adjustment] Structured re-parse produced no rows",
        );
        return applyFailure("structured_parse_failed");
      }
      structuredRowsByDayId.set(change.planDayId, rows);
    } catch (err) {
      // bearer:disable javascript_lang_logger_leak — err is an AI parse error
      // plus internal identifiers, no message or workout content.
      log.warn(
        { err, userId, proposalId, planDayId: change.planDayId },
        "[plan-adjustment] Structured re-parse failed; proposal left pending",
      );
      return applyFailure("structured_parse_failed");
    }
  }

  const aiSource = proposal.aiSource;
  try {
    await db.transaction(async (tx) => {
      for (const change of changes) {
        const live = liveDays.get(change.planDayId);
        if (!live) throw new Error(`missing live day for ${change.planDayId}`);

        const updates = buildUpdatePlanDayPayload(change, live.day, aiSource, unitPreferences);
        const updated = await storage.plans.updatePlanDay(
          change.planDayId,
          updates,
          userId,
          tx,
        );
        if (!updated) throw new Error(`plan day ${change.planDayId} disappeared during apply`);

        const structuredRows = structuredRowsByDayId.get(change.planDayId);
        if (structuredRows) {
          await applyStructuredPlanDaySuggestionRows(
            change.planDayId,
            "replace",
            structuredRows,
            tx,
          );
        } else if (change.structured && change.kind === "rest_conversion") {
          // Rest conversion on a table-backed day clears its prescription
          // rows (applyStructuredPlanDaySuggestionRows early-returns on []).
          await tx.delete(exerciseSets).where(eq(exerciseSets.planDayId, change.planDayId));
        }
      }

      const resolved = await storage.planProposals.resolve(proposalId, userId, "applied", tx);
      if (!resolved) throw new Error("proposal no longer pending");
    });
  } catch (err) {
    // bearer:disable javascript_lang_logger_leak — err is a DB/consistency
    // error plus internal identifiers, no message or workout content.
    log.warn({ err, userId, proposalId }, "[plan-adjustment] Apply transaction rolled back");
    return applyFailure("not_pending");
  }

  // Deliberately NOT enqueuing auto-coach for rescheduled days here (unlike
  // updatePlanDayWithCleanup): the proposal itself already performed the
  // rebalancing that the auto-coach pass would otherwise redo.
  // bearer:disable javascript_lang_logger_leak — internal identifiers and a
  // count only, no message or workout content.
  log.info(
    { userId, proposalId, changeCount: changes.length },
    "[plan-adjustment] Proposal applied",
  );
  return { applied: true, changeCount: changes.length };
}

export async function dismissPlanAdjustmentProposal(
  userId: string,
  proposalId: string,
): Promise<{ dismissed: boolean } | undefined> {
  const proposal = await storage.planProposals.getById(proposalId, userId);
  if (!proposal) return undefined;
  if (proposal.status !== "pending") return { dismissed: false };
  const resolved = await storage.planProposals.resolve(proposalId, userId, "dismissed");
  return { dismissed: Boolean(resolved) };
}
