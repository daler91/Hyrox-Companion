import type { ExerciseName, ParsedExercise } from "@shared/schema";
import { ArrowRight, Loader2 } from "lucide-react";

import type { StructuredExercise } from "@/components/ExerciseInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkoutComposer } from "@/components/workout/WorkoutComposer";
import type { useToast } from "@/hooks/use-toast";
import type { ParseFromImagePayload } from "@/lib/api";
import { getTodayString, getYesterdayString } from "@/lib/dateUtils";

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
 * (free text, voice, or photo). Continue advances to Confirm and, if the
 * description has changed since the last parse, triggers parseNow so the
 * structured table is ready when step 2 mounts.
 */
export function CaptureStep({
  title,
  setTitle,
  date,
  setDate,
  freeText,
  setFreeText,
  exerciseBlocks,
  exerciseData,
  addExercise,
  updateBlock,
  removeBlock,
  reorderBlocks,
  weightUnit,
  distanceUnit,
  autoParsing,
  autoParseError,
  parseNow,
  cancelAutoParse,
  isListening,
  isSupported,
  interimTranscript,
  toggleListening,
  stopListening,
  toast,
  defaultPanelOpen,
  onParseImage,
  isParsingImage,
  onCancel,
  onContinue,
}: CaptureStepProps) {
  const today = getTodayString();
  const yesterday = getYesterdayString();
  const hasText = freeText.trim().length > 0;
  const hasBlocks = exerciseBlocks.length > 0;
  const isWorking = autoParsing || isParsingImage;
  const canContinue = hasText || hasBlocks;

  const handleContinue = () => {
    // Fire a parse if the user has typed text but no blocks have been
    // produced yet (or the blocks are stale relative to the text). The
    // composer's existing parseNow path handles the LLM call; step 2
    // shows the loading state while it resolves.
    if (hasText && !hasBlocks) parseNow(freeText);
    onContinue();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Workout details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title (Optional)</Label>
              <Input
                id="title"
                placeholder="e.g., Morning Push"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="input-workout-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                data-testid="input-workout-date"
              />
            </div>
          </div>
          <fieldset className="flex flex-wrap gap-2 border-0 p-0 m-0">
            <legend className="sr-only">Quick-pick workout date</legend>
            <Button
              type="button"
              variant={date === today ? "default" : "outline"}
              size="sm"
              onClick={() => setDate(today)}
              data-testid="button-date-today"
            >
              Today
            </Button>
            <Button
              type="button"
              variant={date === yesterday ? "default" : "outline"}
              size="sm"
              onClick={() => setDate(yesterday)}
              data-testid="button-date-yesterday"
            >
              Yesterday
            </Button>
          </fieldset>
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
            setFreeText={setFreeText}
            exerciseBlocks={exerciseBlocks}
            exerciseData={exerciseData}
            addExercise={addExercise}
            updateBlock={updateBlock}
            removeBlock={removeBlock}
            reorderBlocks={reorderBlocks}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            autoParsing={autoParsing}
            autoParseError={autoParseError}
            parseNow={parseNow}
            cancelAutoParse={cancelAutoParse}
            isListening={isListening}
            isSupported={isSupported}
            interimTranscript={interimTranscript}
            toggleListening={toggleListening}
            stopListening={stopListening}
            toast={toast}
            defaultPanelOpen={defaultPanelOpen ?? true}
            onParseImage={onParseImage}
            isParsingImage={isParsingImage}
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

