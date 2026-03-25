import { EXERCISE_DEFINITIONS, type ParsedExercise, type ExerciseName } from "@shared/schema";
import type { MutableRefObject } from "react";
import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSensor, useSensors, PointerSensor, KeyboardSensor, type DragEndEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { type StructuredExercise, createDefaultSet } from "@/components/ExerciseInput";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";


interface UseWorkoutEditorOptions {
  initialBlockCounter?: number;
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

export function exerciseToPayload(ex: StructuredExercise) {
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

export function generateSummary(exercises: StructuredExercise[], weightUnit: string, distanceUnit: string): string {
  const distLabel = distanceUnit === "km" ? "m" : "ft";
  // ⚡ Bolt Performance Optimization:
  // Replaced multiple array method allocations (O(N) .map and .every) with single traversal for...of loops.
  // This reduces memory pressure and function allocations during frequent renders.
  const summaries: string[] = [];

  for (const ex of exercises) {
    const def = EXERCISE_DEFINITIONS[ex.exerciseName];
    const name = ex.exerciseName === "custom" && ex.customLabel ? ex.customLabel : def?.label || ex.exerciseName;
    const sets = ex.sets || [];

    if (sets.length === 0) {
      summaries.push(`${name}: completed`);
      continue;
    }

    const firstSet = sets[0];
    let allSame = true;
    for (let i = 1; i < sets.length; i++) {
      if (sets[i].reps !== firstSet.reps || sets[i].weight !== firstSet.weight) {
        allSame = false;
        break;
      }
    }

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

    summaries.push(`${name}: ${parts.join(", ") || "completed"}`);
  }

  return summaries.join("; ");
}


function processParsedExercises(parsed: ParsedExercise[], counterRef: MutableRefObject<number>) {
  const newBlocks: string[] = [];
  const newData: Record<string, StructuredExercise> = {};

  for (const ex of parsed) {
    const rawName = ex.exerciseName as ExerciseName;
    const isKnown = rawName in EXERCISE_DEFINITIONS;
    const exName = isKnown ? rawName : ("custom" as ExerciseName);
    const blockId = makeBlockId(exName === "custom" ? `custom:${ex.customLabel || ex.exerciseName}` : exName, counterRef);

    newBlocks.push(blockId);
    newData[blockId] = {
      exerciseName: exName,
      category: isKnown ? EXERCISE_DEFINITIONS[rawName].category : ex.category,
      customLabel: isKnown ? undefined : (ex.customLabel || ex.exerciseName),
      confidence: ex.confidence,
      missingFields: ex.missingFields,
      sets: ex.sets.map((s, i) => ({
        setNumber: s.setNumber || i + 1,
        reps: s.reps,
        weight: s.weight,
        distance: s.distance,
        time: s.time,
      })),
    };
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

export function useWorkoutEditor(options: UseWorkoutEditorOptions = {}) {
  const blockCounterRef = useRef(options.initialBlockCounter ?? 0);
  const [exerciseBlocks, setExerciseBlocks] = useState<string[]>([]);
  const [exerciseData, setExerciseData] = useState<Record<string, StructuredExercise>>({});
  const [useTextMode, setUseTextMode] = useState(false);

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
      [blockId]: exercise,
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

  const resetEditor = useCallback((blocks: string[], data: Record<string, StructuredExercise>, textMode: boolean) => {
    setExerciseBlocks(blocks);
    setExerciseData(data);
    setUseTextMode(textMode);
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
    resetEditor,
  };
}
