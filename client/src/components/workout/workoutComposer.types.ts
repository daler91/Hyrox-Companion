import type { ExerciseName, StructureBlockInput } from "@shared/schema";

import type { StructuredExercise } from "@/components/ExerciseInput";
import type { ParseDiagnostics } from "@/hooks/useWorkoutEditor";

export interface ComposerTextProps {
  readonly freeText: string;
  readonly setFreeText: (value: string) => void;
}

export interface ComposerExerciseEditorProps {
  readonly exerciseBlocks: string[];
  readonly exerciseData: Record<string, StructuredExercise>;
  readonly addExercise: (name: ExerciseName, customLabel?: string) => void;
  readonly updateBlock: (blockId: string, data: StructuredExercise) => void;
  readonly removeBlock: (blockId: string) => void;
  readonly reorderBlocks: (nextOrder: string[]) => void;
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
}

export interface ComposerParseDiagnosticsProps {
  readonly parseDiagnostics: ParseDiagnostics;
}

export interface ComposerStructureBlockProps {
  readonly structureBlocks: StructureBlockInput[];
  readonly setStructureBlocks: (blocks: StructureBlockInput[]) => void;
}

export interface ComposerParseControlProps {
  readonly autoParsing: boolean;
  readonly cancelAutoParse: () => void;
}

export interface ComposerExerciseProps
  extends ComposerExerciseEditorProps,
    ComposerParseDiagnosticsProps,
    ComposerStructureBlockProps,
    ComposerParseControlProps {}

export interface ComposerAutoParseProps extends ComposerParseControlProps {
  readonly autoParseError: boolean;
}

export interface ComposerVoiceProps {
  readonly isListening: boolean;
  readonly isSupported: boolean;
  readonly interimTranscript: string;
  readonly toggleListening: () => void;
  readonly stopListening: () => void;
}
