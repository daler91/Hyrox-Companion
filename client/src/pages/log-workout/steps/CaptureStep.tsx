import { ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkoutComposer } from "@/components/workout/WorkoutComposer";
import { WorkoutDateFields } from "@/components/workout/WorkoutDateFields";
import type { useToast } from "@/hooks/use-toast";
import type { ParseFromImagePayload, ParseWorkoutStructureResponse } from "@/lib/api";

import type { ComposerAutoParseProps, ComposerExerciseProps, ComposerTextProps, ComposerVoiceProps } from "../sharedComposerProps";
import { StepFooter } from "../StepFooter";

interface CaptureStepProps extends ComposerTextProps, ComposerExerciseProps, ComposerAutoParseProps, ComposerVoiceProps {
  readonly title: string;
  readonly setTitle: (value: string) => void;
  readonly date: string;
  readonly setDate: (value: string) => void;
  readonly toast: ReturnType<typeof useToast>["toast"];
  readonly defaultPanelOpen?: boolean;
  readonly onParseImage: (
    payload: ParseFromImagePayload,
    opts?: { onSuccess?: (parsed: ParseWorkoutStructureResponse) => void },
  ) => void;
  readonly isParsingImage: boolean;
  readonly onCancel: () => void;
  /**
   * Fired when the user clicks Continue. The parent owns the parse-trigger
   * + checkpoint logic so the bookkeeping survives this step's unmount on
   * stepper transitions.
   */
  readonly onContinue: () => void;
}

/**
 * Step 1 of the log-workout stepper. Lets the user describe today's session
 * (free text, voice, or photo). Continue is wired up at the parent so the
 * parse-checkpoint state persists across step transitions.
 */
export function CaptureStep({
  title,
  setTitle,
  date,
  setDate,
  freeText,
  exerciseBlocks,
  autoParsing,
  isParsingImage,
  defaultPanelOpen,
  onCancel,
  onContinue,
  ...composerRest
}: CaptureStepProps) {
  const hasText = freeText.trim().length > 0;
  const hasBlocks = exerciseBlocks.length > 0;
  const isWorking = autoParsing || isParsingImage;
  const canContinue = hasText || hasBlocks;
  // Explain why Continue is disabled so it isn't a dead, unexplained button
  // (WCAG 3.3.2 Labels or Instructions). Suppressed while a parse is in flight.
  const continueBlockedReason =
    !isWorking && !canContinue
      ? "Add your workout above — type it, dictate it, or snap a photo — to continue."
      : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Workout details</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkoutDateFields
            title={title}
            setTitle={setTitle}
            date={date}
            setDate={setDate}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Describe today's workout</CardTitle>
          <p className="text-sm text-muted-foreground">
            Type, dictate, or snap a photo. We'll structure it into exercises
            on the next step.
          </p>
        </CardHeader>
        <CardContent>
          <WorkoutComposer
            freeText={freeText}
            exerciseBlocks={exerciseBlocks}
            autoParsing={autoParsing}
            isParsingImage={isParsingImage}
            defaultPanelOpen={defaultPanelOpen ?? true}
            {...composerRest}
          />
        </CardContent>
      </Card>

      {continueBlockedReason && (
        <output
          id="capture-continue-hint"
          className="block text-center text-xs text-muted-foreground"
          data-testid="text-continue-blocked-reason"
        >
          {continueBlockedReason}
        </output>
      )}

      <StepFooter>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={onCancel}
          data-testid="button-cancel-workout"
          className="flex-1 sm:flex-none"
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={onContinue}
          disabled={!canContinue || isWorking}
          aria-describedby={continueBlockedReason ? "capture-continue-hint" : undefined}
          data-testid="button-step-continue"
          className="flex-1 sm:flex-none sm:min-w-40"
        >
          {isWorking ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
          ) : (
            <ArrowRight className="h-4 w-4 mr-2" aria-hidden />
          )}
          Continue to exercises
        </Button>
      </StepFooter>
    </div>
  );
}
