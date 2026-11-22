import type { ExerciseSet } from "@shared/schema";
import { minutesOrAbsent } from "@shared/units";

/** What a draft row is built from; an omitted field is stored as null. */
export interface DraftExerciseSetSeed {
  id: string;
  exerciseName: string;
  customLabel?: string | null;
  category: string;
  setNumber: number;
  sortOrder: number;
  reps?: number | null;
  weight?: number | null;
  distance?: number | null;
  time?: number | null;
  plannedReps?: number | null;
  plannedWeight?: number | null;
  plannedDistance?: number | null;
  plannedTime?: number | null;
  notes?: string | null;
  confidence?: number | null;
  blockId?: string | null;
  stepNumber?: number | null;
  intervalMinute?: number | null;
  cycleNumber?: number | null;
  stepRole?: string | null;
  groupId?: string | null;
  intensity?: Record<string, unknown> | null;
  load?: Record<string, unknown> | null;
  repMode?: string | null;
  tempo?: Record<string, unknown> | null;
  standards?: Record<string, unknown> | null;
}

/**
 * A client-side draft `ExerciseSet` row, for a table that edits sets before
 * they are saved. AdhocLogSheet and the Log Workout DraftExerciseTable each
 * wrote this ~32-field literal out. (CH-draftSet, REFACTORING_REVIEW 2026-09-23)
 */
export function makeDraftExerciseSet(seed: DraftExerciseSetSeed): ExerciseSet {
  return {
    id: seed.id,
    workoutLogId: null,
    planDayId: null,
    exerciseName: seed.exerciseName,
    customLabel: seed.customLabel ?? null,
    category: seed.category,
    setNumber: seed.setNumber,
    reps: seed.reps ?? null,
    weight: seed.weight ?? null,
    // A client-side DRAFT holds what the athlete typed and is never persisted
    // from here — the server stamps the unit on ingestion (audit L4). Unstamped
    // is therefore the correct shape for a draft row.
    weightUnit: null,
    distance: seed.distance ?? null,
    distanceUnit: null,
    time: minutesOrAbsent(seed.time ?? null),
    plannedReps: seed.plannedReps ?? null,
    plannedWeight: seed.plannedWeight ?? null,
    plannedDistance: seed.plannedDistance ?? null,
    plannedTime: minutesOrAbsent(seed.plannedTime ?? null),
    blockId: seed.blockId ?? null,
    stepNumber: seed.stepNumber ?? null,
    intervalMinute: seed.intervalMinute ?? null,
    cycleNumber: seed.cycleNumber ?? null,
    stepRole: seed.stepRole ?? null,
    groupId: seed.groupId ?? null,
    intensity: seed.intensity ?? null,
    load: seed.load ?? null,
    repMode: seed.repMode ?? null,
    tempo: seed.tempo ?? null,
    standards: seed.standards ?? null,
    notes: seed.notes ?? null,
    confidence: seed.confidence ?? null,
    sortOrder: seed.sortOrder,
    version: 1, // draft rows haven't been persisted; placeholder version (W18)
  };
}
