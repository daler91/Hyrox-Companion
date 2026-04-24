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

interface SyntheticSet extends ExerciseSet {
  readonly _blockId: string;
  readonly _setIdx: number;
}

interface BlockSetLocation {
  readonly blockId: string;
  readonly setIdx: number;
}

/**
 * Drop-in exercise table for the Log Workout draft flow. Presents the
 * same compact one-row-per-exercise layout as the workout-detail
 * dialog's `ExerciseTable` by synthesising an `ExerciseSet[]` from the
 * in-memory block state and translating the set-level edit callbacks
 * (update / add / delete / sortOrder) back into block operations.
 *
 * Synthetic set IDs are stable per `(blockId, setIdx)` so expanded-row
 * state and focus survive re-renders. Drag-reorder's sortOrder patches
 * fire one-per-set; we buffer them into a microtask and emit a single
 * block-level reorder so the persistent state doesn't oscillate.
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
  const { syntheticSets, locationById } = useMemo(() => {
    const sets: SyntheticSet[] = [];
    const map = new Map<string, BlockSetLocation>();
    let sortOrder = 0;
    for (const blockId of exerciseBlocks) {
      const data = exerciseData[blockId];
      if (!data) continue;
      const blockSets = data.sets.length > 0 ? data.sets : [createDefaultSet(1)];
      for (let i = 0; i < blockSets.length; i++) {
        const s = blockSets[i];
        const id = `draft::${blockId}::${i}`;
        map.set(id, { blockId, setIdx: i });
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
          notes: s.notes ?? null,
          confidence: data.confidence ?? null,
          sortOrder: sortOrder++,
          _blockId: blockId,
          _setIdx: i,
        } as SyntheticSet);
      }
    }
    return { syntheticSets: sets as ExerciseSet[], locationById: map };
  }, [exerciseBlocks, exerciseData]);

  // Live refs so the reorder flush (scheduled as a microtask) reads
  // the latest mapping, not a closure snapshot from the keystroke
  // that scheduled it. Synced in an effect to keep render pure.
  const locationRef = useRef(locationById);
  const blocksRef = useRef(exerciseBlocks);
  useEffect(() => {
    locationRef.current = locationById;
  }, [locationById]);
  useEffect(() => {
    blocksRef.current = exerciseBlocks;
  }, [exerciseBlocks]);

  // Buffer for sortOrder-only patches that arrive from ExerciseTable's
  // drag-end handler. It emits one patch per moved set; we collapse
  // them into a single reorderBlocks call so React doesn't commit an
  // intermediate order mid-drag.
  const pendingSortOrderRef = useRef<Map<string, number>>(new Map());
  const flushScheduledRef = useRef(false);

  const flushPendingReorder = useCallback(() => {
    flushScheduledRef.current = false;
    const pending = pendingSortOrderRef.current;
    if (pending.size === 0) return;
    const locs = locationRef.current;
    const currentBlocks = blocksRef.current;

    // Pick the lowest sortOrder seen per block — that's the block's new
    // position. Unseen blocks hold their relative order against the
    // changed ones via a stable secondary sort on their current index.
    const blockMin = new Map<string, number>();
    for (const [setId, order] of pending) {
      const loc = locs.get(setId);
      if (!loc) continue;
      const prev = blockMin.get(loc.blockId);
      if (prev == null || order < prev) blockMin.set(loc.blockId, order);
    }
    pending.clear();

    if (blockMin.size === 0) return;
    const indexed = currentBlocks.map((id, idx) => ({
      id,
      // Blocks that weren't touched by the drag fall back to a large
      // sentinel based on their current index so they sort after the
      // moved blocks resolve; the stable comparator below keeps their
      // relative order intact.
      sort: blockMin.get(id) ?? currentBlocks.length + idx,
      original: idx,
    }));
    indexed.sort((a, b) => (a.sort - b.sort) || (a.original - b.original));
    const nextOrder = indexed.map((x) => x.id);
    const sameOrder =
      nextOrder.length === currentBlocks.length &&
      nextOrder.every((id, i) => id === currentBlocks[i]);
    if (!sameOrder) reorderBlocks(nextOrder);
  }, [reorderBlocks]);

  const scheduleFlush = useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    queueMicrotask(flushPendingReorder);
  }, [flushPendingReorder]);

  const handleUpdateSet = useCallback(
    (setId: string, patch: PatchExerciseSetPayload) => {
      const loc = locationRef.current.get(setId);
      if (!loc) return;

      const keys = Object.keys(patch);
      const isSortOnly = keys.length === 1 && keys[0] === "sortOrder";
      if (isSortOnly) {
        if (typeof patch.sortOrder === "number") {
          pendingSortOrderRef.current.set(setId, patch.sortOrder);
          scheduleFlush();
        }
        return;
      }

      const data = exerciseData[loc.blockId];
      if (!data) return;
      const baseSets = data.sets.length > 0 ? data.sets : [createDefaultSet(1)];
      const nextSets = baseSets.slice();
      const currentSet: SetData = { ...nextSets[loc.setIdx] };
      if ("reps" in patch) currentSet.reps = patch.reps ?? undefined;
      if ("weight" in patch) currentSet.weight = patch.weight ?? undefined;
      if ("distance" in patch) currentSet.distance = patch.distance ?? undefined;
      if ("time" in patch) currentSet.time = patch.time ?? undefined;
      if ("notes" in patch) currentSet.notes = patch.notes ?? undefined;
      if ("setNumber" in patch && typeof patch.setNumber === "number") {
        currentSet.setNumber = patch.setNumber;
      }
      nextSets[loc.setIdx] = currentSet;

      const nextBlock: StructuredExercise = { ...data, sets: nextSets };
      if ("customLabel" in patch) {
        nextBlock.customLabel = patch.customLabel ?? undefined;
      }
      if ("exerciseName" in patch && patch.exerciseName) {
        nextBlock.exerciseName = patch.exerciseName as ExerciseName;
      }
      if ("category" in patch && patch.category) {
        nextBlock.category = patch.category;
      }
      updateBlock(loc.blockId, nextBlock);
    },
    [exerciseData, scheduleFlush, updateBlock],
  );

  const handleAddSet = useCallback(
    (payload: AddExerciseSetPayload) => {
      const targetName = payload.exerciseName as ExerciseName;
      const targetLabel = payload.customLabel ?? undefined;
      const isContinuation = (payload.setNumber ?? 1) > 1;

      // InlineSetEditor's "Add set" path passes setNumber > 1 — extend
      // the matching block so the new set groups with its siblings.
      if (isContinuation) {
        for (let i = exerciseBlocks.length - 1; i >= 0; i--) {
          const blockId = exerciseBlocks[i];
          const data = exerciseData[blockId];
          if (!data) continue;
          if (
            data.exerciseName === targetName &&
            (data.customLabel ?? undefined) === targetLabel
          ) {
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
            updateBlock(blockId, { ...data, sets: nextSets });
            return;
          }
        }
      }

      // Otherwise this is the picker's "Add exercise" — mint a new
      // block. For custom exercises, propagate the supplied label so
      // the new row renders with the user's chosen name instead of
      // the canonical "Custom exercise" placeholder.
      addExercise(targetName, targetLabel);
    },
    [addExercise, exerciseBlocks, exerciseData, updateBlock],
  );

  const handleDeleteSet = useCallback(
    (setId: string) => {
      const loc = locationRef.current.get(setId);
      if (!loc) return;
      const data = exerciseData[loc.blockId];
      if (!data) return;
      const baseSets = data.sets.length > 0 ? data.sets : [createDefaultSet(1)];
      if (baseSets.length <= 1) {
        removeBlock(loc.blockId);
        return;
      }
      const nextSets = baseSets
        .filter((_, i) => i !== loc.setIdx)
        .map((s, i) => ({ ...s, setNumber: i + 1 }));
      updateBlock(loc.blockId, { ...data, sets: nextSets });
    },
    [exerciseData, removeBlock, updateBlock],
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

