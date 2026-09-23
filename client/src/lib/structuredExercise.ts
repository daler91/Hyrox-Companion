import type { ExerciseName } from "@shared/schema/exercises";

import type { WorkoutStructureConfig } from "@/components/workout-structure";

/**
 * The client-side shape of one exercise block while a workout is being
 * composed or edited: the log-workout flow, its draft persistence, the
 * auto-parse merge, and the save payload all pass these around before the
 * server turns them into `exercise_sets` rows.
 */

export interface SetData {
  setNumber: number;
  reps?: number;
  weight?: number;
  distance?: number;
  time?: number;
  plannedReps?: number;
  plannedWeight?: number;
  plannedDistance?: number;
  plannedTime?: number;
  blockId?: string | null;
  stepNumber?: number | null;
  intervalMinute?: number | null;
  cycleNumber?: number | null;
  stepRole?: string | null;
  groupId?: string | null;
  notes?: string;
}

export interface StructuredExercise {
  exerciseName: ExerciseName;
  category: string;
  customLabel?: string;
  confidence?: number;
  missingFields?: string[];
  sets: SetData[];
  /**
   * Flipped to true when the user touches any field on this block via
   * the editor. Auto-parse uses this as a merge guard: a matching block
   * with `hasUserEdits` is preserved across re-parses so the user's
   * edits don't get clobbered as they keep typing in the text field.
   * Client-side only — never round-trips to the server.
   */
  hasUserEdits?: boolean;
  structure?: WorkoutStructureConfig;
}

export function createDefaultSet(setNumber: number): SetData {
  return { setNumber };
}
