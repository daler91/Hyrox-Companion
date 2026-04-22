import { EXERCISE_DEFINITIONS, type ExerciseName, type ExerciseSet } from "@shared/schema";

import { type StructuredExercise } from "@/components/ExerciseInput";

export const categoryChipColors: Record<string, string> = {
  functional: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  running: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  strength: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  conditioning: "bg-red-500/10 text-red-600 dark:text-red-400",
};

export const categoryBorderColors: Record<string, string> = {
  functional: "border-l-orange-500",
  running: "border-l-blue-500",
  strength: "border-l-purple-500",
  conditioning: "border-l-red-500",
};

export const categoryLabels: Record<string, string> = {
  functional: "Functional",
  running: "Running",
  strength: "Strength",
  conditioning: "Conditioning",
};

// Matches labels the AI parser occasionally leaks in place of a real name —
// a bare set multiplier like "2", "10", "2x", "3X". For known exercises we
// prefer the canonical definition over these.
const BOGUS_LABEL_RE = /^\d+\s*[xX]?$/;

export function getExerciseLabel(name: string, customLabel?: string | null): string {
  // `customLabel` acts as a display override for any exercise — a user-renamed
  // "Assault Bike" → "Echo Bike" shows "Echo Bike" in the UI while the
  // underlying `exerciseName` + `category` stay intact so PR/analytics
  // aggregation continues to work against the canonical name.
  //
  // Custom exercises (exerciseName === "custom") use customLabel AS the
  // display name, so we trust it verbatim. For known exerciseNames we guard
  // against parser-leaked numeric labels ("2", "2x"), falling back to the
  // canonical definition.
  const trimmed = customLabel?.trim();
  if (trimmed && trimmed.length > 0) {
    if (name === "custom" || name.startsWith("custom:")) return trimmed;
    if (!BOGUS_LABEL_RE.test(trimmed)) return trimmed;
  }
  if (name.startsWith("custom:")) return name.slice(7);
  const def = EXERCISE_DEFINITIONS[name as ExerciseName];
  return def?.label || name;
}

export interface GroupedExercise {
  exerciseName: string;
  customLabel?: string | null;
  category: string;
  confidence?: number | null;
  sets: ExerciseSet[];
}

export function groupExerciseSets(dbSets: ExerciseSet[]): GroupedExercise[] {
  const sorted = [...dbSets].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const groups: GroupedExercise[] = [];
  let currentKey: string | null = null;
  let currentGroup: GroupedExercise | null = null;
  for (const s of sorted) {
    const key = s.exerciseName === "custom" && s.customLabel
      ? `custom:${s.customLabel}`
      : s.exerciseName;
    if (key !== currentKey) {
      currentGroup = { exerciseName: s.exerciseName, customLabel: s.customLabel, category: s.category, confidence: s.confidence, sets: [] };
      groups.push(currentGroup);
      currentKey = key;
    }
    currentGroup!.sets.push(s);
  }
  return groups;
}

// ⚡ Perf: Single loop with early exit replaces two separate .every() traversals,
// cutting iterations from 2N to at most N.
function checkSetUniformity(sets: ExerciseSet[]): { allSameReps: boolean; allSameWeight: boolean } {
  const firstSet = sets[0];
  let allSameReps = true;
  let allSameWeight = true;
  for (let i = 1; i < sets.length; i++) {
    if (allSameReps && sets[i].reps !== firstSet.reps) allSameReps = false;
    if (allSameWeight && sets[i].weight !== firstSet.weight) allSameWeight = false;
    if (!allSameReps && !allSameWeight) break;
  }
  return { allSameReps, allSameWeight };
}

// ⚡ Perf: Use Set for O(1) lookups instead of Array.includes() which is O(N),
// reducing overall complexity from O(N²) to O(N).
function getUniqueWeights(sets: ExerciseSet[]): number[] {
  const seen = new Set<number>();
  const weights: number[] = [];
  for (const s of sets) {
    const w = s.weight;
    if (w && !seen.has(w)) {
      seen.add(w);
      weights.push(w);
    }
  }
  return weights;
}

export function formatExerciseSummary(group: GroupedExercise, weightUnit: string, distanceUnit: string): string {
  const name = getExerciseLabel(group.exerciseName, group.customLabel);
  const sets = group.sets;
  if (sets.length === 0) return name;

  const firstSet = sets[0];
  const { allSameReps, allSameWeight } = checkSetUniformity(sets);
  const parts: string[] = [];

  if (allSameReps && firstSet.reps && sets.length > 1) {
    parts.push(`${sets.length}x${firstSet.reps}`);
  } else if (firstSet.reps && sets.length === 1) {
    parts.push(`${firstSet.reps}r`);
  } else if (sets.length > 1) {
    parts.push(`${sets.length}s`);
  }

  if (allSameWeight && firstSet.weight) {
    parts.push(`${firstSet.weight}${weightUnit}`);
  } else if (!allSameWeight) {
    const weights = getUniqueWeights(sets);
    if (weights.length > 0) parts.push(`${weights.join("/")}${weightUnit}`);
  }

  const dLabel = distanceUnit === "km" ? "m" : "ft";
  if (firstSet.distance) parts.push(`${firstSet.distance}${dLabel}`);
  if (firstSet.time) parts.push(`${firstSet.time}min`);

  return parts.length > 0 ? `${name} ${parts.join(" ")}` : name;
}


export function exerciseSetsToStructured(dbSets: ExerciseSet[]): { names: string[]; data: Record<string, StructuredExercise> } {
  const groups = groupExerciseSets(dbSets);
  const names: string[] = [];
  const data: Record<string, StructuredExercise> = {};
  const counter = new Map<string, number>();
  for (const group of groups) {
    const baseName = group.exerciseName === "custom" && group.customLabel
      ? `custom:${group.customLabel}`
      : group.exerciseName;
    const count = (counter.get(baseName) || 0) + 1;
    counter.set(baseName, count);
    const key = `${baseName}__${count}`;
    names.push(key);
    data[key] = {
      exerciseName: group.exerciseName as ExerciseName,
      category: group.category,
      customLabel: group.customLabel || undefined,
      confidence: group.confidence ?? undefined,
      sets: group.sets.map(s => ({
        setNumber: s.setNumber,
        reps: s.reps ?? undefined,
        weight: s.weight ?? undefined,
        distance: s.distance ?? undefined,
        time: s.time ?? undefined,
        notes: s.notes ?? undefined,
      })),
    };
  }
  return { names, data };
}
