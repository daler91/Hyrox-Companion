import type { InsertWorkoutLog, ParsedExercise } from "@shared/schema";

import type { StructuredExercise } from "@/components/ExerciseInput";

export interface WorkoutFormInitialValues {
  title?: string;
  date?: string;
  freeText?: string;
  notes?: string;
  rpe?: number | null;
}

export interface UseWorkoutFormProps {
  /**
   * Retained only for draft persistence; save branching keys off
   * `exerciseBlocks.length` so a workout with parsed rows saves as
   * structured regardless of how the text panel is currently toggled.
   */
  useTextMode: boolean;
  exerciseBlocks: string[];
  exerciseData: Record<string, StructuredExercise>;
  weightLabel: string;
  distanceUnit: string;
  initialValues?: WorkoutFormInitialValues;
  /**
   * Fires synchronously on successful save, BEFORE the post-save navigation.
   * Consumers use this to run cleanup that must complete while mounted.
   */
  onSaveSuccess?: () => void;
}

export type SaveWorkoutInput = Omit<InsertWorkoutLog, "userId"> & {
  title?: string;
  exercises?: ParsedExercise[];
};
