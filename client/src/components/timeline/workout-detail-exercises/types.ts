import type { ParsedExercise, TimelineEntry, ExerciseName } from "@shared/schema";
import type { StructuredExercise } from "@/components/ExerciseInput";
import type { GroupedExercise } from "@/lib/exerciseUtils";
import type { SensorDescriptor, SensorOptions, DragEndEvent } from "@dnd-kit/core";
import type { UseMutationResult } from "@tanstack/react-query";
import type { EditFormState } from "@/hooks/useWorkoutVoiceForm";
import type React from "react";

export interface SortableDialogBlockProps {
  readonly blockId: string;
  readonly exData: StructuredExercise;
  readonly blockLabel?: string;
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly onChange: (blockId: string, ex: StructuredExercise) => void;
  readonly onRemove: (blockId: string) => void;
}

export interface WorkoutDetailViewProps {
  readonly entry: TimelineEntry;
  readonly grouped: GroupedExercise[];
  readonly hasStructuredData: boolean;
  readonly weightLabel: string;
  readonly distanceUnit: "km" | "miles";
}

export interface WorkoutDetailStravaMetricsProps {
  readonly entry: TimelineEntry;
  readonly distanceUnit: "km" | "miles";
}

export interface WorkoutDetailEditFormProps {
  readonly editForm: EditFormState;
  readonly setEditForm: (form: EditFormState) => void;
  readonly useTextMode: boolean;
  readonly setUseTextMode: (mode: boolean) => void;
  readonly editExercises: string[];
  readonly editExerciseData: Record<string, StructuredExercise>;
  readonly dialogSensors: SensorDescriptor<SensorOptions>[];
  readonly handleEditDragEnd: (event: DragEndEvent) => void;
  readonly handleAddExercise: (name: ExerciseName) => void;
  readonly handleRemoveBlock: (blockId: string) => void;
  readonly updateBlock: (blockId: string, ex: StructuredExercise) => void;
  readonly getSelectedExerciseNames: () => ExerciseName[];
  readonly parseMutation: UseMutationResult<ParsedExercise[], Error, string, unknown>;
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly onParseText: () => void;
  readonly stopAllVoiceRef?: React.MutableRefObject<(() => void) | null>;
  readonly editRpe?: number | null;
  readonly setEditRpe?: (val: number | null) => void;
  readonly source?: string;
}

export interface WorkoutTextModeProps {
  readonly editForm: EditFormState;
  readonly setEditForm: (form: EditFormState) => void;
  readonly isMainListening: boolean;
  readonly isSupported: boolean;
  readonly mainInterim: string;
  readonly startMainListening: () => void;
  readonly stopMainListening: () => void;
  readonly toggleMainListening: () => void;
  readonly onParseText: () => void;
  readonly parseMutation: UseMutationResult<ParsedExercise[], Error, string, unknown>;
}

export interface WorkoutBlockModeProps {
  readonly editExercises: string[];
  readonly editExerciseData: Record<string, StructuredExercise>;
  readonly dialogSensors: SensorDescriptor<SensorOptions>[];
  readonly handleEditDragEnd: (event: DragEndEvent) => void;
  readonly handleAddExercise: (name: ExerciseName) => void;
  readonly handleRemoveBlock: (blockId: string) => void;
  readonly updateBlock: (blockId: string, ex: StructuredExercise) => void;
  readonly getSelectedExerciseNames: () => ExerciseName[];
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly blockCounts: Record<string, number>;
  readonly blockIndices: Record<string, number>;
}

export interface WorkoutAccessoryNotesProps {
  readonly editForm: EditFormState;
  readonly setEditForm: (form: EditFormState) => void;
  readonly appendToField: (field: keyof EditFormState, text: string) => void;
  readonly stopAccessoryRef: React.MutableRefObject<(() => void) | null>;
  readonly stopNotesRef: React.MutableRefObject<(() => void) | null>;
}
