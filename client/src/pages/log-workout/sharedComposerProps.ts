import type {
  ComposerAutoParseProps,
  ComposerExerciseEditorProps,
  ComposerExerciseProps,
  ComposerParseDiagnosticsProps,
  ComposerTextProps,
  ComposerVoiceProps,
} from "@/components/workout/workoutComposer.types";

export type {
  ComposerAutoParseProps,
  ComposerExerciseProps,
  ComposerTextProps,
  ComposerVoiceProps,
};

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
