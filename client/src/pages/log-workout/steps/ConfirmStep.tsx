import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DraftExerciseTable } from "@/components/workout/DraftExerciseTable";
import { ParseStatusStrip } from "@/components/workout/ParseStatusStrip";

import type { ComposerExerciseProps } from "../sharedComposerProps";
import { StepFooter } from "../StepFooter";

interface ConfirmStepProps extends ComposerExerciseProps {
  readonly freeText: string;
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
  parseDiagnostics,
  cancelAutoParse,
  onBack,
  onContinue,
}: ConfirmStepProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  const hasBlocks = exerciseBlocks.length > 0;
  const needsReviewBanner =
    parseDiagnostics.emptyResult ||
    parseDiagnostics.lowConfidenceCount > 0 ||
    parseDiagnostics.lastErrorReason !== null;
  const wasReviewBannerVisibleRef = useRef(false);

  // Auto-expand once when we ENTER a review-needed state so the user sees
  // the legacy note, but still allow manual collapse afterward.
  useEffect(() => {
    if (needsReviewBanner && !wasReviewBannerVisibleRef.current) {
      setShowOriginal(true);
    }
    wasReviewBannerVisibleRef.current = needsReviewBanner;
  }, [needsReviewBanner]);

  // Cancel any in-flight parse before mutating the exercise list so a
  // late parse response can't overwrite the user's in-progress edits.
  const handleAddExercise = useCallback(
    (...args: Parameters<ComposerExerciseProps["addExercise"]>) => {
      const [name, customLabel] = args;
      cancelAutoParse();
      addExercise(name, customLabel);
    },
    [cancelAutoParse, addExercise],
  );
  const handleUpdateBlock = useCallback(
    (...args: Parameters<ComposerExerciseProps["updateBlock"]>) => {
      const [blockId, ex] = args;
      cancelAutoParse();
      updateBlock(blockId, ex);
    },
    [cancelAutoParse, updateBlock],
  );
  const handleRemoveBlock = useCallback(
    (...args: Parameters<ComposerExerciseProps["removeBlock"]>) => {
      const [blockId] = args;
      cancelAutoParse();
      removeBlock(blockId);
    },
    [cancelAutoParse, removeBlock],
  );
  const handleReorderBlocks = useCallback(
    (...args: Parameters<ComposerExerciseProps["reorderBlocks"]>) => {
      const [nextOrder] = args;
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
            Tap any value to edit. Changes save as you go — perfect for updating reps or weight
            between sets.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {autoParsing && <ParseStatusStrip parsing data-testid="confirm-step-parsing" />}

          {!autoParsing && needsReviewBanner && (
            <div
              className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
              role="status"
              aria-live="polite"
              data-testid="confirm-step-parse-review-banner"
            >
              Couldn’t fully structure this workout yet — review and fix.
            </div>
          )}

          {!autoParsing && !hasBlocks && (
            <div
              className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-sm text-muted-foreground"
              data-testid="confirm-step-empty"
            >
              No structured exercises yet. Add exercises manually below, or go back and describe
              your workout.
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
                  {showOriginal ? "Hide" : "View"} original description (legacy note)
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
          disabled={autoParsing}
          data-testid="button-step-continue"
          className="flex-1 sm:flex-none sm:min-w-40"
        >
          {autoParsing ? (
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
