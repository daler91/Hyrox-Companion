import { EXERCISE_DEFINITIONS, type ExerciseName, type StructureBlockInput } from "@shared/schema";
import { useCallback, useEffect, useRef, useState } from "react";

import { createDefaultSet, type StructuredExercise } from "@/components/ExerciseInput";

import { getBlockExerciseName, makeBlockId } from "./workout-editor/blockHelpers";
import { useParseWorkoutFromImageMutation, useParseWorkoutMutation } from "./workout-editor/parseMutations";
import { useAutoParse } from "./workout-editor/useAutoParse";
import { useWorkoutSensors } from "./workout-editor/useWorkoutSensors";

// Re-exports for the pre-split import surface: saveWorkoutPayload.ts,
// workoutComposer.types.ts, and the tests import these from this module.
export { exerciseToPayload, generateSummary, getBlockExerciseName, makeBlockId } from "./workout-editor/blockHelpers";
export { mergeParsedWithEdits } from "./workout-editor/parseMerging";
export {
  type ParseImagePayload,
  parseWorkoutText,
  useParseWorkoutFromImageMutation,
  useParseWorkoutMutation,
} from "./workout-editor/parseMutations";
export { type ParseDiagnostics } from "./workout-editor/useAutoParse";
export { useWorkoutSensors } from "./workout-editor/useWorkoutSensors";

interface UseWorkoutEditorOptions {
  initialBlockCounter?: number;
  initialExerciseBlocks?: string[];
  initialExerciseData?: Record<string, StructuredExercise>;
  initialUseTextMode?: boolean;
  initialStructureBlocks?: StructureBlockInput[];
}

// Draft blocks restored from localStorage (or the server) pre-date the
// `hasUserEdits` flag on StructuredExercise. Without this migration,
// the first auto-parse would treat them as "unedited = replaceable" and
// silently wipe structured rows a user had already built up. Mark every
// restored block as edited so the merge preserves them until the user
// explicitly deletes one.
function markInitialDataAsEdited(
  data: Record<string, StructuredExercise>,
): Record<string, StructuredExercise> {
  const marked: Record<string, StructuredExercise> = {};
  for (const key of Object.keys(data)) {
    marked[key] = { ...data[key], hasUserEdits: true };
  }
  return marked;
}

/**
 * Facade over the workout-editor modules: owns the exercise-block state
 * (ids, per-block data, structure blocks, text mode) and composes drag
 * reordering (useWorkoutSensors), the manual text/image parse mutations,
 * and the live auto-parse engine (useAutoParse). The pure block/merge
 * helpers live in ./workout-editor/.
 */
export function useWorkoutEditor(options: UseWorkoutEditorOptions = {}) {
  const blockCounterRef = useRef(options.initialBlockCounter ?? 0);
  const [exerciseBlocks, setExerciseBlocks] = useState<string[]>(
    options.initialExerciseBlocks ?? [],
  );
  const [exerciseData, setExerciseData] = useState<Record<string, StructuredExercise>>(
    () => markInitialDataAsEdited(options.initialExerciseData ?? {}),
  );
  const [useTextMode, setUseTextMode] = useState(options.initialUseTextMode ?? false);
  const [structureBlocks, setStructureBlocks] = useState<StructureBlockInput[]>(options.initialStructureBlocks ?? []);

  // Live refs so the auto-parse callback stays stable across renders but
  // still sees the latest merge inputs when it fires. Without these the
  // debounce timer would close over a stale snapshot and keep overwriting
  // a freshly-edited block with parsed data.
  const blocksRef = useRef(exerciseBlocks);
  const dataRef = useRef(exerciseData);
  useEffect(() => {
    blocksRef.current = exerciseBlocks;
  }, [exerciseBlocks]);
  useEffect(() => {
    dataRef.current = exerciseData;
  }, [exerciseData]);

  const { sensors, handleDragEnd } = useWorkoutSensors(setExerciseBlocks);

  const addExercise = useCallback((name: ExerciseName, customLabel?: string) => {
    const isLegacyEmom = name === "emom";
    const safeName: ExerciseName = isLegacyEmom ? "custom" : name;
    const safeCustomLabel = isLegacyEmom ? (customLabel || "EMOM") : customLabel;
    const blockKey = safeName === "custom" && safeCustomLabel ? `custom:${safeCustomLabel}` : safeName;
    const blockId = makeBlockId(blockKey, blockCounterRef);
    const def = EXERCISE_DEFINITIONS[safeName];
    setExerciseBlocks(prev => [...prev, blockId]);
    setExerciseData(prev => ({
      ...prev,
      [blockId]: {
        exerciseName: safeName,
        category: def.category,
        customLabel: safeCustomLabel,
        sets: [createDefaultSet(1)],
        // Manually adding an exercise counts as an edit — the user
        // asked for this row, auto-parse shouldn't replace it.
        hasUserEdits: true,
      },
    }));
  }, []);

  const removeBlock = useCallback((blockId: string) => {
    setExerciseBlocks(prev => prev.filter(b => b !== blockId));
    setExerciseData(prev => {
      const newData = { ...prev };
      delete newData[blockId];
      return newData;
    });
  }, []);

  const reorderBlocks = useCallback((nextOrder: string[]) => {
    setExerciseBlocks(prev => {
      // Guard against stale orderings: the caller may race a concurrent
      // add/remove. If the incoming order has a different set of ids than
      // what's currently in state, drop the reorder — the next render
      // will pass a fresh order.
      if (nextOrder.length !== prev.length) return prev;
      const prevSet = new Set(prev);
      for (const id of nextOrder) {
        if (!prevSet.has(id)) return prev;
      }
      return nextOrder;
    });
  }, []);

  const updateBlock = useCallback((blockId: string, exercise: StructuredExercise) => {
    setExerciseData(prev => ({
      ...prev,
      // Any in-app edit flips `hasUserEdits` so subsequent auto-parses
      // preserve this block. Callers don't need to track this; passing
      // the updated exercise through here is enough.
      [blockId]: { ...exercise, hasUserEdits: true },
    }));
  }, []);

  const getSelectedExerciseNames = useCallback((): ExerciseName[] => {
    return exerciseBlocks.map(blockId => getBlockExerciseName(blockId) as ExerciseName);
  }, [exerciseBlocks]);

  const applyManualParseResult = useCallback((
    newBlocks: string[],
    newData: Record<string, StructuredExercise>,
    newStructureBlocks: StructureBlockInput[],
  ) => {
    setExerciseBlocks(newBlocks);
    setExerciseData(newData);
    setStructureBlocks(newStructureBlocks);
    setUseTextMode(false);
  }, []);

  const parseMutation = useParseWorkoutMutation(blockCounterRef, {
    onSuccess: applyManualParseResult,
    onError: () => {},
  });

  const parseImageMutation = useParseWorkoutFromImageMutation(blockCounterRef, {
    onSuccess: applyManualParseResult,
    onError: () => {},
  });

  const applyAutoParseResult = useCallback((
    newBlocks: string[],
    newData: Record<string, StructuredExercise>,
    newStructureBlocks: StructureBlockInput[],
  ) => {
    setExerciseBlocks(newBlocks);
    setExerciseData(newData);
    setStructureBlocks(newStructureBlocks);
  }, []);

  const {
    autoParsing,
    autoParseError,
    parseDiagnostics,
    lastParsedAt,
    scheduleAutoParse,
    cancelAutoParse,
    parseNow,
    resetAutoParse,
  } = useAutoParse({
    blockCounterRef,
    blocksRef,
    dataRef,
    onApply: applyAutoParseResult,
  });

  const resetEditor = useCallback((blocks: string[], data: Record<string, StructuredExercise>, textMode: boolean, nextStructureBlocks: StructureBlockInput[] = []) => {
    // Reseeded blocks came from the server or a duplicate-last flow;
    // treat them as user-confirmed content so a subsequent auto-parse
    // doesn't erase them.
    const markedData: Record<string, StructuredExercise> = {};
    for (const id of blocks) {
      const d = data[id];
      if (d) markedData[id] = { ...d, hasUserEdits: true };
    }
    setExerciseBlocks(blocks);
    setExerciseData(markedData);
    setUseTextMode(textMode);
    setStructureBlocks(nextStructureBlocks);
    // Clear any in-flight auto-parse state so the freshly reset content
    // isn't overwritten by a debounced call from the previous session.
    resetAutoParse();

    // Seed the global block counter to a value higher than any suffix
    // in the hydrated block ids, so subsequent addExercise calls don't
    // collide with existing keys like "back-squat__1".
    let maxSuffix = 0;
    for (const block of blocks) {
      const parts = block.split("__");
      const n = Number.parseInt(parts.at(-1) ?? "", 10);
      if (Number.isFinite(n) && n > maxSuffix) maxSuffix = n;
    }
    if (maxSuffix > blockCounterRef.current) {
      blockCounterRef.current = maxSuffix;
    }
  }, [resetAutoParse]);

  return {
    exerciseBlocks,
    exerciseData,
    useTextMode,
    setUseTextMode,
    structureBlocks,
    setStructureBlocks,
    sensors,
    handleDragEnd,
    addExercise,
    removeBlock,
    updateBlock,
    reorderBlocks,
    getSelectedExerciseNames,
    parseMutation,
    parseImageMutation,
    resetEditor,
    // Auto-parse surface for the composer.
    autoParsing,
    autoParseError,
    parseDiagnostics,
    lastParsedAt,
    scheduleAutoParse,
    cancelAutoParse,
    parseNow,
  };
}
