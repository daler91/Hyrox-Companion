import type { ExerciseName } from "@shared/schema";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";

import type { StructuredExercise } from "@/components/ExerciseInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DraftExerciseTable } from "@/components/workout/DraftExerciseTable";
import { ParseStatusStrip } from "@/components/workout/ParseStatusStrip";

import { StepFooter } from "../StepFooter";

interface ConfirmStepProps {
  readonly freeText: string;
  readonly exerciseBlocks: string[];
  readonly exerciseData: Record<string, StructuredExercise>;
  readonly addExercise: (name: ExerciseName, customLabel?: string) => void;
  readonly updateBlock: (blockId: string, data: StructuredExercise) => void;
  readonly removeBlock: (blockId: string) => void;
  readonly reorderBlocks: (nextOrder: string[]) => void;
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly autoParsing: boolean;
  readonly isReparsePending: boolean;
  readonly cancelAutoParse: () => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}

/**
 * Step 2: Confirm and live-log structured exercises. Doubles as the
 * during-workout editing surface — users tap into reps/weight inputs to
 * adjust actuals between sets. The DraftExerciseTable already auto-saves
 * on blur via the editor's draft-persistence pipeline.
 */
export function ConfirmStep({
  freeText,
  exerciseBlocks,
  exerciseData,
  addExercise,
  updateBlock,
  removeBlock,
  reorderBlocks,
  weightUnit,
  distanceUnit,
  autoParsing,
  isReparsePending,
  cancelAutoParse,
  onBack,
  onContinue,
}: ConfirmStepProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  const hasBlocks = exerciseBlocks.length > 0;

  // Cancel any in-flight parse before mutating the exercise list so a
  // late parse response can't overwrite the user's in-progress edits.
  const handleAddExercise = useCallback(
    (name: ExerciseName, customLabel?: string) => {
      cancelAutoParse();
      addExercise(name, customLabel);
    },
    [cancelAutoParse, addExercise],
  );
  const handleUpdateBlock = useCallback(
    (blockId: string, ex: StructuredExercise) => {
      cancelAutoParse();
      updateBlock(blockId, ex);
    },
    [cancelAutoParse, updateBlock],
  );
  const handleRemoveBlock = useCallback(
    (blockId: string) => {
      cancelAutoParse();
      removeBlock(blockId);
    },
    [cancelAutoParse, removeBlock],
  );
  const handleReorderBlocks = useCallback(
    (nextOrder: string[]) => {
      cancelAutoParse();
      reorderBlocks(nextOrder);
    },
    [cancelAutoParse, reorderBlocks],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Confirm exercises</CardTitle>
          <p className="text-sm text-muted-foreground">
            Tap any value to edit. Changes save as you go — perfect for
            updating reps or weight between sets.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {(autoParsing || isReparsePending) && (
            <ParseStatusStrip parsing data-testid="confirm-step-parsing" />
          )}

          {!autoParsing && !hasBlocks && (
            <div
              className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-sm text-muted-foreground"
              data-testid="confirm-step-empty"
            >
              No structured exercises yet. Add exercises manually below, or
              go back and describe your workout.
            </div>
          )}

          <DraftExerciseTable
            exerciseBlocks={exerciseBlocks}
            exerciseData={exerciseData}
            addExercise={handleAddExercise}
            updateBlock={handleUpdateBlock}
            removeBlock={handleRemoveBlock}
            reorderBlocks={handleReorderBlocks}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
          />

          {freeText.trim().length > 0 && (
            <Collapsible open={showOriginal} onOpenChange={setShowOriginal}>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  data-testid="button-show-original"
                >
                  {showOriginal ? "Hide" : "View"} original description
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre
                  className="whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-xs text-muted-foreground"
                  data-testid="text-original-description"
                >
                  {freeText}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>

      <StepFooter>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={onBack}
          data-testid="button-step-back"
          className="flex-1 sm:flex-none"
        >
          <ArrowLeft className="h-4 w-4 mr-2" aria-hidden />
          Back
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={onContinue}
          disabled={autoParsing || isReparsePending}
          data-testid="button-step-continue"
          className="flex-1 sm:flex-none sm:min-w-40"
        >
          {autoParsing || isReparsePending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
          ) : (
            <ArrowRight className="h-4 w-4 mr-2" aria-hidden />
          )}
          Continue to RPE & notes
        </Button>
      </StepFooter>
    </div>
  );
}
