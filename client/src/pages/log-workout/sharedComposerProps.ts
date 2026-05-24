import type {
  ComposerAutoParseProps,
  ComposerExerciseEditorProps,
  ComposerParseDiagnosticsProps,
  ComposerTextProps,
  ComposerVoiceProps,
} from "@/components/workout/workoutComposer.types";

export type {
  ComposerAutoParseProps,
  ComposerTextProps,
  ComposerVoiceProps,
};

export type { ComposerExerciseProps } from "@/components/workout/workoutComposer.types";

/**
 * Composer state shared between CaptureStep (consumer) and
 * LogWorkoutStepperLayout (parent).
 */
export interface SharedComposerProps
  extends ComposerTextProps,
    ComposerExerciseEditorProps,
    ComposerAutoParseProps,
    ComposerParseDiagnosticsProps,
    ComposerVoiceProps {}
