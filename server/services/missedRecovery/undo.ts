import type {
  ExerciseSet,
  PlanDay,
  PlanDayRecovery,
  PlanDayRecoveryUndo,
  RecoveryScaledSetField,
  RecoveryUndoField,
  RecoveryUndoScaledSet,
} from "@shared/schema";
import { planDayRecoveryEnum } from "@shared/schema";

import type { PlanDayRecoverySetUpdate, PlanDayRecoveryWrite } from "../../storage/plans";

/**
 * Taking back a fold or a shorten. Moving a missed session records what the
 * move changed ({@link captureMove}); undoing it puts the day back where it
 * was missed, undecided, with its whole prescription
 * ({@link planUndo}) — so the athlete gets the three options again.
 *
 * Anything the athlete has changed since the move is theirs, and stays: a day
 * field or a set's value comes back only where it still reads what the move
 * wrote. Pure: nothing here reads or writes the database.
 */

/** A set's prescription values a shorten can scale, by field. */
function scalableValues(set: ExerciseSet): Map<RecoveryScaledSetField, number | null> {
  return new Map<RecoveryScaledSetField, number | null>([
    ["reps", set.reps],
    ["plannedReps", set.plannedReps],
    ["distance", set.distance],
    ["plannedDistance", set.plannedDistance],
    ["time", set.time],
    ["plannedTime", set.plannedTime],
  ]);
}

/** The fields an update writes, with the values it writes. */
function writtenFields(update: PlanDayRecoverySetUpdate): [RecoveryScaledSetField, number][] {
  return (Object.entries(update) as [keyof PlanDayRecoverySetUpdate, string | number | undefined][]).filter(
    (entry): entry is [RecoveryScaledSetField, number] => entry[0] !== "id" && typeof entry[1] === "number",
  );
}

/** What a shorten did beyond moving the day, for {@link captureMove}. */
export interface MoveEdits {
  /** The day's sets before the cut. */
  readonly sets: readonly ExerciseSet[];
  readonly deleteSetIds: readonly string[];
  readonly setUpdates: readonly PlanDayRecoverySetUpdate[];
  readonly notes?: string | null;
  readonly expectedDurationMin?: number | null;
}

function knownRecovery(value: string | null): PlanDayRecovery | null {
  return (planDayRecoveryEnum as readonly (string | null)[]).includes(value) ? (value as PlanDayRecovery) : null;
}

/** `{ before, after }` when the move changes the field, nothing otherwise. */
function fieldChange<T>(before: T, after: T | undefined): RecoveryUndoField<T> | undefined {
  return after === undefined || after === before ? undefined : { before, after };
}

/** The values a set update overwrites, as they were. */
function scaledSet(set: ExerciseSet, update: PlanDayRecoverySetUpdate): RecoveryUndoScaledSet {
  const current = scalableValues(set);
  const written = writtenFields(update);
  return {
    id: set.id,
    before: Object.fromEntries(written.map(([field]) => [field, current.get(field) ?? null])),
    after: Object.fromEntries(written),
  };
}

/**
 * The day as it stands before a fold or shorten moves it, and what the move
 * changes, to be stored with the move. Keeps the undo it replaces, so a
 * session moved twice goes back one move at a time.
 */
export function captureMove(day: PlanDay, edits?: MoveEdits): PlanDayRecoveryUndo {
  const byId = new Map((edits?.sets ?? []).map((set) => [set.id, set]));
  const deleted = new Set(edits?.deleteSetIds ?? []);
  const scaledSets = (edits?.setUpdates ?? []).flatMap((update) => {
    const set = byId.get(update.id);
    return set ? [scaledSet(set, update)] : [];
  });
  const notes = fieldChange(day.notes, edits?.notes);
  const expectedDurationMin = fieldChange(day.expectedDurationMin, edits?.expectedDurationMin);
  return {
    // Only a scheduled day can be missed, so a move always starts from a date.
    scheduledDate: day.scheduledDate ?? "",
    status: day.status === "missed" ? "missed" : "planned",
    recovery: knownRecovery(day.recovery),
    missedOn: day.missedOn,
    ...(notes ? { notes } : {}),
    ...(expectedDurationMin ? { expectedDurationMin } : {}),
    deletedSets: (edits?.sets ?? []).filter((set) => deleted.has(set.id)),
    scaledSets,
    previous: day.recoveryUndo ?? null,
  };
}

function lines(text: string | null): string[] {
  return text ? text.split("\n") : [];
}

/**
 * The notes to put back, or undefined to leave them. Unchanged since the move,
 * they return whole; edited, only the lines the move added come out — the
 * shortened session's "do about 60% of it" must not outlive the shortening.
 */
function restoredNotes(current: string | null, change: RecoveryUndoField<string | null>): string | null | undefined {
  if (current === change.after) return change.before;
  const kept = new Set(lines(change.before));
  const added = new Set(lines(change.after).filter((line) => !kept.has(line)));
  const currentLines = lines(current);
  const remaining = currentLines.filter((line) => !added.has(line));
  if (remaining.length === currentLines.length) return undefined;
  return remaining.join("\n") || null;
}

/** The scaled values still as the shorten wrote them, set back. Null when there is nothing to restore. */
function restoredSet(current: ExerciseSet, scaled: RecoveryUndoScaledSet): PlanDayRecoverySetUpdate | null {
  const now = scalableValues(current);
  const before = new Map(Object.entries(scaled.before) as [RecoveryScaledSetField, number | null][]);
  const restore = (Object.entries(scaled.after) as [RecoveryScaledSetField, number][]).flatMap(([field, after]) => {
    const original = before.get(field);
    return now.get(field) === after && typeof original === "number" ? [[field, original] as const] : [];
  });
  return restore.length > 0 ? { id: current.id, ...Object.fromEntries(restore) } : null;
}

export type UndoWrite = Omit<PlanDayRecoveryWrite, "guard">;

/**
 * The write that takes the move back: the day to its missed date and state,
 * the undo before this one back in place, the dropped sets back in, and the
 * scaled values, notes and duration back where the athlete has not changed
 * them since.
 */
export function planUndo(day: PlanDay, undo: PlanDayRecoveryUndo, currentSets: readonly ExerciseSet[]): UndoWrite {
  const present = new Map(currentSets.map((set) => [set.id, set]));
  const notes = undo.notes ? restoredNotes(day.notes, undo.notes) : undefined;
  const duration = undo.expectedDurationMin;
  const restoreDuration = duration !== undefined && day.expectedDurationMin === duration.after;
  return {
    update: {
      scheduledDate: undo.scheduledDate,
      status: undo.status,
      recovery: undo.recovery,
      missedOn: undo.missedOn,
      recoveryUndo: undo.previous,
      ...(notes === undefined ? {} : { notes }),
      ...(restoreDuration ? { expectedDurationMin: duration.before } : {}),
    },
    insertSets: undo.deletedSets.filter((set) => !present.has(set.id)),
    setUpdates: undo.scaledSets.flatMap((scaled) => {
      const current = present.get(scaled.id);
      const update = current ? restoredSet(current, scaled) : null;
      return update ? [update] : [];
    }),
  };
}
