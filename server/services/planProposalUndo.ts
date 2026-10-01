import {
  type ExerciseSet,
  type InsertExerciseSet,
  PLAN_PROPOSAL_UNDO_FIELDS,
  PLAN_PROPOSAL_UNDO_WINDOW_MS,
  type PlanAdjustmentProposal,
  type PlanDay,
  type PlanProposalDayUndo,
  type PlanProposalFieldUndo,
  type PlanProposalUndoField,
  type UpdatePlanDay,
} from "@shared/schema";

import { buildWorkoutPrescriptionFingerprint, mapExerciseSetToPromptDetail } from "./aiModificationGuard";

/**
 * Taking back an applied plan proposal (AI coach chat review, I6). The apply
 * records, per day, what it replaced and what it wrote ({@link captureDayUndo});
 * the undo puts back only what still reads what the apply wrote
 * ({@link planDayRestore}). A field the athlete edited since, a newer coach
 * note, or an exercise table changed since is theirs and stays — the rule
 * missed-session recovery's undo follows. Pure: nothing here touches the
 * database.
 */

/** A fingerprint of an exercise table alone, to tell whether it changed since the apply. */
export function setsFingerprint(rows: ReadonlyArray<ExerciseSet | InsertExerciseSet>): string {
  return (
    buildWorkoutPrescriptionFingerprint({
      mainWorkout: "",
      exerciseDetails: rows.map(mapExerciseSetToPromptDetail),
    }) ?? ""
  );
}

type UndoFields = PlanProposalDayUndo["fields"];

/** `{ before, after }` for each field the apply changed. */
function changedFields(before: PlanDay, after: PlanDay, written: UpdatePlanDay): UndoFields {
  const fields: Record<string, PlanProposalFieldUndo<unknown>> = {};
  for (const field of PLAN_PROPOSAL_UNDO_FIELDS) {
    if (written[field] === undefined || after[field] === before[field]) continue;
    fields[field] = { before: before[field], after: after[field] };
  }
  return fields;
}

/** What the apply did to the day's exercise table, when it replaced or cleared it. */
export interface SetsWrite {
  readonly before: ExerciseSet[];
  /** The table as the apply left it, read back inside the apply's transaction. */
  readonly after: readonly ExerciseSet[];
}

/**
 * What one day's apply replaced and wrote. `after` is the row the update
 * returned, so the values are the ones stored, unit normalisation included.
 */
export function captureDayUndo(
  before: PlanDay,
  after: PlanDay,
  written: UpdatePlanDay,
  sets?: SetsWrite,
): PlanProposalDayUndo {
  return {
    planDayId: before.id,
    fields: changedFields(before, after, written),
    coachNote: {
      before: {
        aiSource: before.aiSource,
        aiRationale: before.aiRationale,
        aiNoteUpdatedAt: before.aiNoteUpdatedAt?.toISOString() ?? null,
        aiInputsUsed: before.aiInputsUsed,
      },
      writtenAt: (after.aiNoteUpdatedAt ?? new Date(0)).toISOString(),
    },
    ...(sets ? { sets: { before: sets.before, afterFingerprint: setsFingerprint(sets.after) } } : {}),
  };
}

/** One day's undo: the update and the exercise table to put back, and whether anything stays as it is. */
export interface DayRestore {
  readonly planDayId: string;
  /** Null when no field or note comes back. */
  readonly update: UpdatePlanDay | null;
  /** The exercise table to put back in place of the current one; null to leave it. */
  readonly sets: ExerciseSet[] | null;
  /** Something the apply wrote has changed since, so it stays. */
  readonly kept: boolean;
}

function restoredFields(undo: PlanProposalDayUndo, day: PlanDay): { update: UpdatePlanDay; kept: boolean } {
  const update: UpdatePlanDay = {};
  let kept = false;
  for (const [field, change] of Object.entries(undo.fields) as [PlanProposalUndoField, PlanProposalFieldUndo<unknown>][]) {
    if (day[field] === change.after) Object.assign(update, { [field]: change.before });
    else kept = true;
  }
  return { update, kept };
}

/** The coach note back as it was, while the note on the day is still the one the apply wrote. */
function restoredCoachNote(undo: PlanProposalDayUndo, day: PlanDay): UpdatePlanDay | null {
  if (day.aiNoteUpdatedAt?.getTime() !== Date.parse(undo.coachNote.writtenAt)) return null;
  const { before } = undo.coachNote;
  return {
    aiSource: before.aiSource,
    aiRationale: before.aiRationale,
    aiNoteUpdatedAt: before.aiNoteUpdatedAt ? new Date(before.aiNoteUpdatedAt) : null,
    aiInputsUsed: before.aiInputsUsed,
  };
}

/**
 * What an undo writes to one day. A day that is gone, or is no longer
 * planned (done, skipped, missed), keeps everything: it has moved on.
 */
export function planDayRestore(
  undo: PlanProposalDayUndo,
  day: PlanDay | undefined,
  currentSets: readonly ExerciseSet[],
): DayRestore {
  if (day?.status !== "planned") {
    return { planDayId: undo.planDayId, update: null, sets: null, kept: true };
  }
  const fields = restoredFields(undo, day);
  const coachNote = restoredCoachNote(undo, day);
  const setsUnchanged = undo.sets ? setsFingerprint(currentSets) === undo.sets.afterFingerprint : true;
  const update = { ...fields.update, ...coachNote };
  return {
    planDayId: undo.planDayId,
    update: Object.keys(update).length > 0 ? update : null,
    sets: undo.sets && setsUnchanged ? undo.sets.before : null,
    kept: fields.kept || coachNote === null || !setsUnchanged,
  };
}

/** The plan days an applied proposal changed: all of them, unless the athlete picked some. */
export function appliedPlanDayIds(proposal: PlanAdjustmentProposal): string[] {
  return proposal.applyUndo
    ? proposal.applyUndo.days.map((day) => day.planDayId)
    : proposal.payload.changes.map((change) => change.planDayId);
}

/** Applied, with a record of what it wrote, recently enough to take back. */
export function isUndoable(proposal: PlanAdjustmentProposal, now: number = Date.now()): boolean {
  if (proposal.status !== "applied" || !proposal.applyUndo || !proposal.resolvedAt) return false;
  return now - proposal.resolvedAt.getTime() <= PLAN_PROPOSAL_UNDO_WINDOW_MS;
}
