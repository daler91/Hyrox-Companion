import type { ExerciseName, ParsedExercise } from "@shared/schema";
import { ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";

import type { StructuredExercise } from "@/components/ExerciseInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkoutComposer } from "@/components/workout/WorkoutComposer";
import { WorkoutDateFields } from "@/components/workout/WorkoutDateFields";
import type { useToast } from "@/hooks/use-toast";
import type { ParseFromImagePayload } from "@/lib/api";

import { StepFooter } from "../StepFooter";

interface CaptureStepProps {
  readonly title: string;
  readonly setTitle: (value: string) => void;
  readonly date: string;
  readonly setDate: (value: string) => void;
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
  readonly parseNow: (text: string) => void;
  readonly cancelAutoParse: () => void;
  readonly isListening: boolean;
  readonly isSupported: boolean;
  readonly interimTranscript: string;
  readonly toggleListening: () => void;
  readonly stopListening: () => void;
  readonly toast: ReturnType<typeof useToast>["toast"];
  readonly defaultPanelOpen?: boolean;
  readonly onParseImage: (
    payload: ParseFromImagePayload,
    opts?: { onSuccess?: (parsed: ParsedExercise[]) => void },
  ) => void;
  readonly isParsingImage: boolean;
  readonly onCancel: () => void;
  readonly onContinue: () => void;
}

/**
 * Step 1 of the log-workout stepper. Lets the user describe today's session
 * (free text, voice, or photo). Continue advances to Confirm and triggers a
 * parse whenever the text has changed since the last parse — even if blocks
 * already exist from a previous visit to this step.
 */
export function CaptureStep({
  title,
  setTitle,
  date,
  setDate,
  freeText,
  exerciseBlocks,
  autoParsing,
  autoParseError,
  isParsingImage,
  parseNow,
  defaultPanelOpen,
  onCancel,
  onContinue,
  ...composerRest
}: CaptureStepProps) {
  const hasText = freeText.trim().length > 0;
  const hasBlocks = exerciseBlocks.length > 0;
  const isWorking = autoParsing || isParsingImage;
  const canContinue = hasText || hasBlocks;

  // lastParsedTextRef advances only when a parse actually completes
  // successfully — not at dispatch time — so returning to step 1 after a
  // failed parse still offers a re-parse.
  const lastParsedTextRef = useRef(hasBlocks ? freeText : "");
  const pendingParseText = useRef<string | null>(null);

  // Commit lastParsedTextRef only after a parse finishes without error.
  useEffect(() => {
    if (!autoParsing && !autoParseError && pendingParseText.current !== null) {
      lastParsedTextRef.current = pendingParseText.current;
      pendingParseText.current = null;
    }
  }, [autoParsing, autoParseError]);

  const handleContinue = () => {
    const needsParse = hasText && (freeText !== lastParsedTextRef.current || !hasBlocks);
    if (needsParse) {
      pendingParseText.current = freeText;
      parseNow(freeText);
    }
    onContinue();
  };

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
            autoParseError={autoParseError}
            isParsingImage={isParsingImage}
            parseNow={parseNow}
            defaultPanelOpen={defaultPanelOpen ?? true}
            {...composerRest}
          />
        </CardContent>
      </Card>

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
          onClick={handleContinue}
          disabled={!canContinue || isWorking}
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
