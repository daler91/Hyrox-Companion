import type { ExerciseName } from "@shared/schema";

import type { StructuredExercise } from "@/components/ExerciseInput";

/**
 * Composer state shared between CaptureStep (consumer) and
 * LogWorkoutStepperLayout (parent). Hoisted into one definition so the
 * 19-line block of `readonly freeText…stopListening` declarations doesn't
 * duplicate between the two prop interfaces.
 */
export interface SharedComposerProps {
  readonly freeText: string;
  readonly setFreeText: (value: string) => void;
  readonly exerciseBlocks: string[];
  readonly exerciseData: Record<string, StructuredExercise>;
  readonly addExercise: (name: ExerciseName, customLabel?: string) => void;
  readonly updateBlock: (blockId: string, data: StructuredExercise) => void;
  readonly removeBlock: (blockId: string) => void;
  readonly reorderBlocks: (nextOrder: string[]) => void;
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly autoParsing: boolean;
  readonly autoParseError: boolean;
  readonly cancelAutoParse: () => void;
  readonly isListening: boolean;
  readonly isSupported: boolean;
  readonly interimTranscript: string;
  readonly toggleListening: () => void;
  readonly stopListening: () => void;
}
