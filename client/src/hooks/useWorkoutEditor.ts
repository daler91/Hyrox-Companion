import { type DragEndEvent,KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove,sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { EXERCISE_DEFINITIONS, type ExerciseName,type ParsedExercise } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { useCallback,useEffect, useRef, useState } from "react";

import { createDefaultSet,type StructuredExercise } from "@/components/ExerciseInput";
import { useToast } from "@/hooks/use-toast";
import { api, type ParseFromImagePayload } from "@/lib/api";


interface UseWorkoutEditorOptions {
  initialBlockCounter?: number;
  initialExerciseBlocks?: string[];
  initialExerciseData?: Record<string, StructuredExercise>;
  initialUseTextMode?: boolean;
}

export function makeBlockId(name: string, counterRef: MutableRefObject<number>) {
  counterRef.current += 1;
  return `${name}__${counterRef.current}`;
}

export function getBlockExerciseName(blockId: string): string {
  const parts = blockId.split("__");
  const name = parts.slice(0, -1).join("__") || parts[0];
  if (name.startsWith("custom:")) return "custom";
  return name;
}

export function exerciseToPayload(ex: StructuredExercise | ParsedExercise) {
  return {
    exerciseName: ex.exerciseName,
    customLabel: ex.customLabel,
    category: ex.category,
    confidence: ex.confidence,
    sets: (ex.sets || []).map(s => ({
      setNumber: s.setNumber,
      reps: s.reps,
      weight: s.weight,
      distance: s.distance,
      time: s.time,
      notes: s.notes,
    })),
  };
}

function areSetsUniform(sets: NonNullable<StructuredExercise["sets"]>): boolean {
  if (sets.length <= 1) return true;
  const firstSet = sets[0];
  for (let i = 1; i < sets.length; i++) {
    if (sets[i].reps !== firstSet.reps || sets[i].weight !== firstSet.weight) {
      return false;
    }
  }
  return true;
}

function formatExerciseSummary(ex: StructuredExercise, weightUnit: string, distLabel: string): string {
  const def = EXERCISE_DEFINITIONS[ex.exerciseName];
  const name = ex.exerciseName === "custom" && ex.customLabel ? ex.customLabel : def?.label || ex.exerciseName;
  const sets = ex.sets || [];

  if (sets.length === 0) {
    return `${name}: completed`;
  }

  const firstSet = sets[0];
  const allSame = areSetsUniform(sets);

  const parts: string[] = [];
  if (allSame && sets.length > 1 && firstSet.reps) {
    parts.push(`${sets.length}x${firstSet.reps}`);
  } else if (firstSet.reps) {
    parts.push(`${sets.length > 1 ? sets.length + " sets, " : ""}${firstSet.reps} reps`);
  } else if (sets.length > 1) {
    parts.push(`${sets.length} sets`);
  }

  if (allSame && firstSet.weight) parts.push(`${firstSet.weight}${weightUnit}`);
  if (firstSet.distance) parts.push(`${firstSet.distance}${distLabel}`);
  if (firstSet.time) parts.push(`${firstSet.time}min`);

  return `${name}: ${parts.join(", ") || "completed"}`;
}

export function generateSummary(exercises: StructuredExercise[], weightUnit: string, distanceUnit: string): string {
  const distLabel = distanceUnit === "km" ? "m" : "ft";
  // ⚡ Bolt Performance Optimization:
  // Replaced multiple array method allocations (O(N) .map and .every) with single traversal for...of loops.
  // This reduces memory pressure and function allocations during frequent renders.
  const summaries: string[] = [];

  for (const ex of exercises) {
    summaries.push(formatExerciseSummary(ex, weightUnit, distLabel));
  }

  return summaries.join("; ");
}


interface ParsedBlockBuild {
  readonly exerciseName: ExerciseName;
  readonly blockKey: string;
  readonly data: StructuredExercise;
}

function buildBlockFromParsed(ex: ParsedExercise): ParsedBlockBuild {
  const rawName = ex.exerciseName as ExerciseName;
  const isKnown = rawName in EXERCISE_DEFINITIONS;
  const exName = isKnown ? rawName : ("custom" as ExerciseName);
  const customLabel = isKnown ? undefined : (ex.customLabel || ex.exerciseName);
  const blockKey = exName === "custom" ? `custom:${customLabel ?? ""}` : exName;

  return {
    exerciseName: exName,
    blockKey,
    data: {
      exerciseName: exName,
      category: isKnown ? EXERCISE_DEFINITIONS[rawName].category : ex.category,
      customLabel,
      confidence: ex.confidence,
      missingFields: ex.missingFields,
      sets: ex.sets.map((s, i) => ({
        setNumber: s.setNumber || i + 1,
        reps: s.reps,
        weight: s.weight,
        distance: s.distance,
        time: s.time,
      })),
    },
  };
}

function processParsedExercises(parsed: ParsedExercise[], counterRef: MutableRefObject<number>) {
  const newBlocks: string[] = [];
  const newData: Record<string, StructuredExercise> = {};

  for (const ex of parsed) {
    const built = buildBlockFromParsed(ex);
    const blockId = makeBlockId(built.blockKey, counterRef);
    newBlocks.push(blockId);
    newData[blockId] = built.data;
  }

  return { newBlocks, newData };
}

function mergeKey(name: string, customLabel: string | null | undefined): string {
  return `${name}|${customLabel ?? ""}`;
}

/**
 * Auto-parse merge: user-edited blocks survive across re-parses, unedited
 * blocks from prior parses get replaced by the latest result. A parsed
 * block that matches an edited block (same exerciseName + customLabel)
 * is skipped — the user's version wins.
 *
 * This is the "live typing" path. Semantics:
 *   - EVERY edited block is preserved (including multiple blocks that
 *     share the same exerciseName + customLabel — the UI supports
 *     repeated "log as separate block" additions and we must not drop
 *     the duplicates on re-parse)
 *   - parsed blocks that match any preserved edit's key get skipped
 *     (the user's blocks represent that exercise already)
 *   - unedited existing blocks are dropped (the text is their source
 *     of truth, so the latest parse supersedes them)
 */
export function mergeParsedWithEdits(
  parsed: ParsedExercise[],
  counterRef: MutableRefObject<number>,
  existingBlocks: readonly string[],
  existingData: Readonly<Record<string, StructuredExercise>>,
) {
  const editedKeys = new Set<string>();
  const preservedIds: string[] = [];
  for (const id of existingBlocks) {
    const d = existingData[id];
    if (!d?.hasUserEdits) continue;
    preservedIds.push(id);
    editedKeys.add(mergeKey(d.exerciseName, d.customLabel));
  }

  const newBlocks: string[] = [...preservedIds];
  const newData: Record<string, StructuredExercise> = {};
  for (const id of preservedIds) newData[id] = existingData[id]!;

  for (const ex of parsed) {
    const built = buildBlockFromParsed(ex);
    const key = mergeKey(built.data.exerciseName, built.data.customLabel);
    if (editedKeys.has(key)) continue;
    const blockId = makeBlockId(built.blockKey, counterRef);
    newBlocks.push(blockId);
    newData[blockId] = built.data;
  }

  return { newBlocks, newData };
}

function getParseSuccessDescription(parsed: ParsedExercise[]): string {
  // ⚡ Bolt Performance Optimization:
  // Combine multiple O(N) array filters into a single O(N) traversal
  // to avoid redundant object allocations.
  let lowConfCount = 0;
  let missingCount = 0;

  for (const e of parsed) {
    if (e.confidence != null && e.confidence < 80) lowConfCount++;
    if (e.missingFields && e.missingFields.length > 0) missingCount++;
  }

  let description = `Found ${parsed.length} exercise${parsed.length === 1 ? "" : "s"}.`;
  if (lowConfCount > 0) {
    description += ` ${lowConfCount} may need review (low confidence).`;
  }
  if (missingCount > 0) {
    description += ` ${missingCount} ha${missingCount === 1 ? "s" : "ve"} missing data — check the yellow warnings.`;
  }
  if (lowConfCount === 0 && missingCount === 0) {
    description += " Review the details below.";
  }
  return description;
}

export async function parseWorkoutText(text: string): Promise<ParsedExercise[]> {
  return api.exercises.parse(text);
}


interface UseParseWorkoutMutationOptions {
  onSuccess: (newBlocks: string[], newData: Record<string, StructuredExercise>) => void;
  onError: () => void;
}

export function useParseWorkoutMutation(
  blockCounterRef: MutableRefObject<number>,
  options: UseParseWorkoutMutationOptions
) {
  const { toast } = useToast();

  return useMutation({
    mutationFn: parseWorkoutText,
    onSuccess: (parsed: ParsedExercise[]) => {
      if (parsed.length === 0) {
        toast({
          title: "No exercises found",
          description: "AI couldn't identify any exercises in your text. Try being more specific, e.g. '4x8 back squat at 70kg'.",
          variant: "destructive",
        });
        return;
      }

      const { newBlocks, newData } = processParsedExercises(parsed, blockCounterRef);
      options.onSuccess(newBlocks, newData);

      toast({
        title: "Exercises parsed",
        description: getParseSuccessDescription(parsed),
      });
    },
    onError: () => {
      toast({
        title: "Parsing failed",
        description: "AI couldn't parse your workout text. Please try again or enter exercises manually.",
        variant: "destructive",
      });
      options.onError();
    },
  });
}

export type ParseImagePayload = ParseFromImagePayload;

/**
 * Parse a captured photo of a workout plan into structured blocks. Shares
 * the same post-parse pipeline (`processParsedExercises` → replace blocks)
 * and success/error toast copy family as the text-parse mutation so a
 * source switch doesn't introduce behavioural drift.
 */
export function useParseWorkoutFromImageMutation(
  blockCounterRef: MutableRefObject<number>,
  options: UseParseWorkoutMutationOptions,
) {
  const { toast } = useToast();

  return useMutation({
    mutationFn: (payload: ParseImagePayload) => api.exercises.parseFromImage(payload),
    onSuccess: (parsed: ParsedExercise[]) => {
      if (parsed.length === 0) {
        toast({
          title: "No exercises found",
          description:
            "AI couldn't identify any exercises in that photo. Try a clearer shot with the workout in frame.",
          variant: "destructive",
        });
        return;
      }

      const { newBlocks, newData } = processParsedExercises(parsed, blockCounterRef);
      options.onSuccess(newBlocks, newData);

      toast({
        title: "Exercises parsed",
        description: getParseSuccessDescription(parsed),
      });
    },
    onError: () => {
      toast({
        title: "Parsing failed",
        description:
          "AI couldn't parse that photo. Try a clearer shot or enter exercises manually.",
        variant: "destructive",
      });
      options.onError();
    },
  });
}


export function useWorkoutSensors(setExerciseBlocks: React.Dispatch<React.SetStateAction<string[]>>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setExerciseBlocks((prev) => {
        const oldIndex = prev.indexOf(active.id as string);
        const newIndex = prev.indexOf(over.id as string);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }, [setExerciseBlocks]);

  return { sensors, handleDragEnd };
}

const AUTO_PARSE_DEBOUNCE_MS = 1200;
const AUTO_PARSE_MIN_CHARS = 8;
// Cheap gate so the auto-parse pipeline doesn't burn Gemini calls on
// free-form notes like "felt great". Needs at least one digit or an
// `x`/`×` (set-count separator) before we even consider parsing.
const AUTO_PARSE_SIGNAL_RE = /\d|[xX×]/;

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

export function useWorkoutEditor(options: UseWorkoutEditorOptions = {}) {
  const blockCounterRef = useRef(options.initialBlockCounter ?? 0);
  const [exerciseBlocks, setExerciseBlocks] = useState<string[]>(
    options.initialExerciseBlocks ?? [],
  );
  const [exerciseData, setExerciseData] = useState<Record<string, StructuredExercise>>(
    () => markInitialDataAsEdited(options.initialExerciseData ?? {}),
  );
  const [useTextMode, setUseTextMode] = useState(options.initialUseTextMode ?? false);

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

  const addExercise = useCallback((name: ExerciseName) => {
    const blockId = makeBlockId(name, blockCounterRef);
    const def = EXERCISE_DEFINITIONS[name];
    setExerciseBlocks(prev => [...prev, blockId]);
    setExerciseData(prev => ({
      ...prev,
      [blockId]: {
        exerciseName: name,
        category: def.category,
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

  const parseMutation = useParseWorkoutMutation(blockCounterRef, {
    onSuccess: (newBlocks, newData) => {
      setExerciseBlocks(newBlocks);
      setExerciseData(newData);
      setUseTextMode(false);
    },
    onError: () => {},
  });

  const parseImageMutation = useParseWorkoutFromImageMutation(blockCounterRef, {
    onSuccess: (newBlocks, newData) => {
      setExerciseBlocks(newBlocks);
      setExerciseData(newData);
      // Collapse the text panel on success — the user came in via the
      // photo path, so the structured table is what they want to see now.
      setUseTextMode(false);
    },
    onError: () => {},
  });

  // --- Auto-parse --------------------------------------------------------
  // A single AbortController follows the most recent auto-parse request.
  // Typing during an in-flight request aborts it and the trailing debounce
  // fires a fresh call once the user pauses for `AUTO_PARSE_DEBOUNCE_MS`.
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastParsedTextRef = useRef<string>("");
  const [autoParsing, setAutoParsing] = useState(false);
  const [autoParseError, setAutoParseError] = useState(false);
  const [lastParsedAt, setLastParsedAt] = useState<number | null>(null);

  const runAutoParse = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed === lastParsedTextRef.current) return;
    if (trimmed.length < AUTO_PARSE_MIN_CHARS) return;
    if (!AUTO_PARSE_SIGNAL_RE.test(trimmed)) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setAutoParsing(true);
    setAutoParseError(false);

    try {
      const parsed = await api.exercises.parse(trimmed, { signal: controller.signal });
      if (controller.signal.aborted) return;
      lastParsedTextRef.current = trimmed;
      const { newBlocks, newData } = mergeParsedWithEdits(
        parsed,
        blockCounterRef,
        blocksRef.current,
        dataRef.current,
      );
      setExerciseBlocks(newBlocks);
      setExerciseData(newData);
      setLastParsedAt(Date.now());
    } catch (err) {
      if (controller.signal.aborted) return;
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      if (!isAbort) setAutoParseError(true);
    } finally {
      // Always clear the spinner. Earlier this was gated on
      // `!controller.signal.aborted`, but that left the state stuck
      // true when a parse was aborted AND the subsequent debounced
      // call short-circuited (empty text, under-length, etc.) —
      // nothing in that fast-path resets the flag. A fresh parse will
      // immediately setAutoParsing(true) again; React batches these
      // so there's no visible flicker.
      setAutoParsing(false);
    }
  }, []);

  // Schedule a trailing-debounced auto-parse whenever the free-text
  // changes. Any pending parse gets cancelled on the next call so only
  // the latest text flows through — AND any IN-FLIGHT request is
  // aborted synchronously here so a slow response from outdated text
  // can't land after the user has already moved on and overwrite the
  // composer's state with stale blocks.
  const scheduleAutoParse = useCallback(
    (text: string) => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        runAutoParse(text).catch(() => {
          /* errors surface via autoParseError state inside runAutoParse */
        });
      }, AUTO_PARSE_DEBOUNCE_MS);
    },
    [runAutoParse],
  );

  // Stops any in-flight auto-parse plus the scheduled trailing call.
  // The composer invokes this when the user touches an exercise row so
  // a fresh parse doesn't yank their edit out from under them. Next
  // free-text change re-primes the debounce.
  const cancelAutoParse = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();
    if (autoParsing) setAutoParsing(false);
  }, [autoParsing]);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const resetEditor = useCallback((blocks: string[], data: Record<string, StructuredExercise>, textMode: boolean) => {
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
    // Clear any in-flight auto-parse state so the freshly reset content
    // isn't overwritten by a debounced call from the previous session.
    lastParsedTextRef.current = "";
    abortRef.current?.abort();
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setAutoParsing(false);
    setAutoParseError(false);

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
  }, []);

  return {
    exerciseBlocks,
    exerciseData,
    useTextMode,
    setUseTextMode,
    sensors,
    handleDragEnd,
    addExercise,
    removeBlock,
    updateBlock,
    getSelectedExerciseNames,
    parseMutation,
    parseImageMutation,
    resetEditor,
    // Auto-parse surface for the composer.
    autoParsing,
    autoParseError,
    lastParsedAt,
    scheduleAutoParse,
    cancelAutoParse,
  };
}
