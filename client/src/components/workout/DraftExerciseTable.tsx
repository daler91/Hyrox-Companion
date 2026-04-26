import type { ExerciseName, ExerciseSet } from "@shared/schema";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { createDefaultSet, type SetData, type StructuredExercise } from "@/components/ExerciseInput";
import { ExerciseTable } from "@/components/workout-detail/ExerciseTable";
import type { AddExerciseSetPayload, PatchExerciseSetPayload } from "@/lib/api";

interface DraftExerciseTableProps {
  readonly exerciseBlocks: string[];
  readonly exerciseData: Record<string, StructuredExercise>;
  readonly addExercise: (name: ExerciseName, customLabel?: string) => void;
  readonly updateBlock: (blockId: string, data: StructuredExercise) => void;
  readonly removeBlock: (blockId: string) => void;
  /** Persist a new block ordering — used by drag-reorder. */
  readonly reorderBlocks: (nextOrder: string[]) => void;
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
}

interface BlockSetLocation {
  readonly blockId: string;
  readonly setIdx: number;
}

function applySetPatch(target: SetData, patch: PatchExerciseSetPayload): SetData {
  const next: SetData = { ...target };
  if ("reps" in patch) next.reps = patch.reps ?? undefined;
  if ("weight" in patch) next.weight = patch.weight ?? undefined;
  if ("distance" in patch) next.distance = patch.distance ?? undefined;
  if ("time" in patch) next.time = patch.time ?? undefined;
  if ("notes" in patch) next.notes = patch.notes ?? undefined;
  if ("setNumber" in patch && typeof patch.setNumber === "number") {
    next.setNumber = patch.setNumber;
  }
  return next;
}

function applyBlockPatch(target: StructuredExercise, patch: PatchExerciseSetPayload): StructuredExercise {
  const next: StructuredExercise = { ...target };
  if ("customLabel" in patch) next.customLabel = patch.customLabel ?? undefined;
  if ("exerciseName" in patch && patch.exerciseName) {
    next.exerciseName = patch.exerciseName as ExerciseName;
  }
  if ("category" in patch && patch.category) next.category = patch.category;
  return next;
}

/**
 * Drop-in exercise table for the Log Workout draft flow. Presents the
 * same compact one-row-per-exercise layout as the workout-detail
 * dialog's `ExerciseTable` by synthesising an `ExerciseSet[]` from the
 * in-memory block state and translating the set-level edit callbacks
 * (update / add / delete / sortOrder) back into block operations.
 *
 * Synthetic set IDs are stable per `(blockId, setIdx)` so expanded-row
 * state and focus survive re-renders. Drag-reorder and row-delete both
 * fire multiple patches in one user gesture; we buffer them into a
 * microtask and apply them atomically so intermediate renders don't
 * drop sets or oscillate block order.
 */
export function DraftExerciseTable({
  exerciseBlocks,
  exerciseData,
  addExercise,
  updateBlock,
  removeBlock,
  reorderBlocks,
  weightUnit,
  distanceUnit,
}: DraftExerciseTableProps) {
  const { syntheticSets, locationById, sortOrderById } = useMemo(() => {
    const sets: ExerciseSet[] = [];
    const locMap = new Map<string, BlockSetLocation>();
    const sortMap = new Map<string, number>();
    let sortOrder = 0;
    for (const blockId of exerciseBlocks) {
      const data = exerciseData[blockId];
      if (!data) continue;
      const blockSets = data.sets.length > 0 ? data.sets : [createDefaultSet(1)];
      for (let i = 0; i < blockSets.length; i++) {
        const s = blockSets[i];
        const id = `draft::${blockId}::${i}`;
        locMap.set(id, { blockId, setIdx: i });
        sortMap.set(id, sortOrder);
        sets.push({
          id,
          workoutLogId: null,
          planDayId: null,
          exerciseName: data.exerciseName,
          customLabel: data.customLabel ?? null,
          category: data.category,
          setNumber: s.setNumber ?? i + 1,
          reps: s.reps ?? null,
          weight: s.weight ?? null,
          distance: s.distance ?? null,
          time: s.time ?? null,
          plannedReps: null,
          plannedWeight: null,
          plannedDistance: null,
          plannedTime: null,
          notes: s.notes ?? null,
          confidence: data.confidence ?? null,
          sortOrder,
        });
        sortOrder += 1;
      }
    }
    return { syntheticSets: sets, locationById: locMap, sortOrderById: sortMap };
  }, [exerciseBlocks, exerciseData]);

  // Live refs so the microtask flush reads the latest mapping, not
  // a closure snapshot from the keystroke that scheduled it. Synced
  // in effects to keep render pure.
  const locationRef = useRef(locationById);
  const blocksRef = useRef(exerciseBlocks);
  const dataRef = useRef(exerciseData);
  const sortOrderRef = useRef(sortOrderById);
  useEffect(() => {
    locationRef.current = locationById;
  }, [locationById]);
  useEffect(() => {
    blocksRef.current = exerciseBlocks;
  }, [exerciseBlocks]);
  useEffect(() => {
    dataRef.current = exerciseData;
  }, [exerciseData]);
  useEffect(() => {
    sortOrderRef.current = sortOrderById;
  }, [sortOrderById]);

  // Buffer for sortOrder-only patches that arrive from ExerciseTable's
  // drag-end handler (one patch per moved set) — collapsed into one
  // reorderBlocks call so React doesn't commit an intermediate order.
  const pendingSortOrderRef = useRef<Map<string, number>>(new Map());
  const sortFlushScheduledRef = useRef(false);
  // Buffer for row-delete: ExerciseTable deletes a multi-set row by
  // calling onDeleteSet for every set in the group. Batched per-block
  // so the last call doesn't overwrite earlier ones with a stale set
  // list — see the atomic-flush below.
  const pendingDeletesRef = useRef<Map<string, Set<number>>>(new Map());
  const deleteFlushScheduledRef = useRef(false);

  const flushPendingReorder = useCallback(() => {
    sortFlushScheduledRef.current = false;
    const pending = pendingSortOrderRef.current;
    if (pending.size === 0) return;
    const currentBlocks = blocksRef.current;
    const locs = locationRef.current;
    const sorts = sortOrderRef.current;

    // Effective sortOrder per block = min across its sets. Touched
    // sets use the patched sortOrder; untouched sets retain their
    // current synthetic sortOrder so their block stays in place
    // rather than bunching behind the dragged segment.
    const blockMin = new Map<string, number>();
    for (const [setId, loc] of locs) {
      const nextOrder = pending.get(setId) ?? sorts.get(setId);
      if (nextOrder == null) continue;
      const prev = blockMin.get(loc.blockId);
      if (prev == null || nextOrder < prev) blockMin.set(loc.blockId, nextOrder);
    }
    pending.clear();
    if (blockMin.size === 0) return;

    const nextOrder = [...currentBlocks].sort((a, b) => {
      const ao = blockMin.get(a) ?? Number.POSITIVE_INFINITY;
      const bo = blockMin.get(b) ?? Number.POSITIVE_INFINITY;
      return ao - bo;
    });
    const sameOrder = nextOrder.every((id, i) => id === currentBlocks[i]);
    if (!sameOrder) reorderBlocks(nextOrder);
  }, [reorderBlocks]);

  const flushPendingDeletes = useCallback(() => {
    deleteFlushScheduledRef.current = false;
    const pending = pendingDeletesRef.current;
    if (pending.size === 0) return;
    const currentData = dataRef.current;
    // Snapshot then clear before dispatching so a re-entrant delete
    // (shouldn't happen, but safer) doesn't see half-cleared state.
    const snapshot = new Map(pending);
    pending.clear();

    for (const [blockId, indices] of snapshot) {
      const data = currentData[blockId];
      if (!data) continue;
      const baseSets = data.sets.length > 0 ? data.sets : [createDefaultSet(1)];
      if (indices.size >= baseSets.length) {
        removeBlock(blockId);
        continue;
      }
      const keptSets = baseSets
        .filter((_, i) => !indices.has(i))
        .map((s, i) => ({ ...s, setNumber: i + 1 }));
      updateBlock(blockId, { ...data, sets: keptSets });
    }
  }, [removeBlock, updateBlock]);

  const scheduleSortFlush = useCallback(() => {
    if (sortFlushScheduledRef.current) return;
    sortFlushScheduledRef.current = true;
    queueMicrotask(flushPendingReorder);
  }, [flushPendingReorder]);

  const scheduleDeleteFlush = useCallback(() => {
    if (deleteFlushScheduledRef.current) return;
    deleteFlushScheduledRef.current = true;
    queueMicrotask(flushPendingDeletes);
  }, [flushPendingDeletes]);

  const handleUpdateSet = useCallback(
    (setId: string, patch: PatchExerciseSetPayload) => {
      const loc = locationRef.current.get(setId);
      if (!loc) return;

      const keys = Object.keys(patch);
      if (keys.length === 1 && keys[0] === "sortOrder") {
        if (typeof patch.sortOrder === "number") {
          pendingSortOrderRef.current.set(setId, patch.sortOrder);
          scheduleSortFlush();
        }
        return;
      }

      const data = exerciseData[loc.blockId];
      if (!data) return;
      const baseSets = data.sets.length > 0 ? data.sets : [createDefaultSet(1)];
      const nextSets = baseSets.slice();
      nextSets[loc.setIdx] = applySetPatch(nextSets[loc.setIdx], patch);
      const nextBlock = applyBlockPatch({ ...data, sets: nextSets }, patch);
      updateBlock(loc.blockId, nextBlock);
    },
    [exerciseData, scheduleSortFlush, updateBlock],
  );

  const handleAddSet = useCallback(
    (payload: AddExerciseSetPayload) => {
      const targetName = payload.exerciseName as ExerciseName;
      const targetLabel = payload.customLabel ?? undefined;
      const isContinuation = (payload.setNumber ?? 1) > 1;

      if (isContinuation) {
        // Prefer the originating row's blockId (InlineSetEditor forwards
        // `lastSet.id`), falling back to a name/label match for payloads
        // that pre-date the sourceSetId hint.
        const sourceLoc = payload.sourceSetId
          ? locationRef.current.get(payload.sourceSetId)
          : undefined;
        const targetBlockId =
          sourceLoc?.blockId ??
          findLastMatchingBlockId(exerciseBlocks, exerciseData, targetName, targetLabel);
        if (targetBlockId) {
          const data = exerciseData[targetBlockId];
          if (data) {
            const baseSets = data.sets.length > 0 ? data.sets : [createDefaultSet(1)];
            const nextSets: SetData[] = [
              ...baseSets,
              {
                setNumber: baseSets.length + 1,
                reps: payload.reps ?? undefined,
                weight: payload.weight ?? undefined,
                distance: payload.distance ?? undefined,
                time: payload.time ?? undefined,
                notes: payload.notes ?? undefined,
              },
            ];
            updateBlock(targetBlockId, { ...data, sets: nextSets });
            return;
          }
        }
      }

      // Picker's "Add exercise" path (setNumber == 1 or no matching
      // block to extend) — mint a new block. Custom exercises carry
      // their user-supplied label so the new row renders with the
      // picked name instead of the canonical "Custom exercise"
      // placeholder.
      addExercise(targetName, targetLabel);
    },
    [addExercise, exerciseBlocks, exerciseData, updateBlock],
  );

  const handleDeleteSet = useCallback(
    (setId: string) => {
      const loc = locationRef.current.get(setId);
      if (!loc) return;
      let indices = pendingDeletesRef.current.get(loc.blockId);
      if (!indices) {
        indices = new Set<number>();
        pendingDeletesRef.current.set(loc.blockId, indices);
      }
      indices.add(loc.setIdx);
      scheduleDeleteFlush();
    },
    [scheduleDeleteFlush],
  );

  // ExerciseTable's weight-unit domain is "kg" | "lb"; the draft flow
  // uses "kg" | "lbs". Normalize at the boundary so the prescription
  // suffix ("150 lb") matches the rest of the draft UI.
  const normalizedWeightUnit: "kg" | "lb" = weightUnit === "kg" ? "kg" : "lb";

  return (
    <ExerciseTable
      workoutId="draft"
      exerciseSets={syntheticSets}
      weightUnit={normalizedWeightUnit}
      distanceUnit={distanceUnit}
      onUpdateSet={handleUpdateSet}
      onAddSet={handleAddSet}
      onDeleteSet={handleDeleteSet}
    />
  );
}

function findLastMatchingBlockId(
  exerciseBlocks: readonly string[],
  exerciseData: Record<string, StructuredExercise>,
  name: ExerciseName,
  label: string | undefined,
): string | null {
  for (let i = exerciseBlocks.length - 1; i >= 0; i--) {
    const id = exerciseBlocks[i];
    const data = exerciseData[id];
    if (!data) continue;
    if (data.exerciseName === name && (data.customLabel ?? undefined) === label) {
      return id;
    }
  }
  return null;
}
