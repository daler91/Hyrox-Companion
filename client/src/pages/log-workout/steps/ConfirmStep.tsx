import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DraftExerciseTable } from "@/components/workout/DraftExerciseTable";
import { ParseStatusStrip } from "@/components/workout/ParseStatusStrip";
import { StructureBlocksEditor } from "@/components/workout-structure";

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
  structureBlocks,
  setStructureBlocks,
  onBack,
  onContinue,
}: ConfirmStepProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [dismissedAutoOpen, setDismissedAutoOpen] = useState(false);
  const hasBlocks = exerciseBlocks.length > 0;
  const legacyEmomRowIds = useMemo(
    () => exerciseBlocks.filter((id) => exerciseData[id]?.exerciseName?.toLowerCase() === "emom"),
    [exerciseBlocks, exerciseData],
  );
  const hasLegacyEmomRows = legacyEmomRowIds.length > 0;
  const [emomDurationMinutes, setEmomDurationMinutes] = useState<number>(10);
  const [emomStepLabel, setEmomStepLabel] = useState("Work");
  const [conversionDone, setConversionDone] = useState(false);
  const needsReviewBanner =
    parseDiagnostics.emptyResult ||
    parseDiagnostics.lowConfidenceCount > 0 ||
    parseDiagnostics.lastErrorReason !== null;
  const shouldAutoOpenLegacyNote = needsReviewBanner && !dismissedAutoOpen;
  const isLegacyNoteOpen = showOriginal || shouldAutoOpenLegacyNote;
  const focusManualTableEditor = () => {
    const firstEditable = document.querySelector<HTMLElement>(
      '[data-testid="exercise-table"] input, [data-testid="exercise-table"] button, [data-testid="exercise-table"] [role="textbox"]',
    );
    firstEditable?.focus();
  };

  const handleLegacyNoteOpenChange = useCallback((open: boolean) => {
    setShowOriginal(open);
    if (!open) setDismissedAutoOpen(true);
  }, []);

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
  const handleConvertLegacyEmom = useCallback(() => {
    const firstLegacy = legacyEmomRowIds[0] ? exerciseData[legacyEmomRowIds[0]] : undefined;
    const guessedDuration =
      firstLegacy?.sets?.reduce((max, set) => Math.max(max, set.time ?? 0), 0) ||
      firstLegacy?.sets?.length ||
      emomDurationMinutes;
    const guessedStep = firstLegacy?.customLabel || emomStepLabel;
    const converted = [...structureBlocks, {
      sectionType: "main" as const,
      formatType: "emom" as const,
      durationMinutes: guessedDuration,
      sequenceOrder: structureBlocks.length,
      sortOrder: structureBlocks.length,
      steps: [{ stepNumber: 1, stepType: "work" as const, exerciseName: guessedStep }],
    }];
    setStructureBlocks(converted);
    for (const id of legacyEmomRowIds) {
      const ex = exerciseData[id];
      if (!ex) continue;
      updateBlock(id, { ...ex, exerciseName: "custom", customLabel: ex.customLabel || "EMOM" });
    }
    setConversionDone(true);
  }, [legacyEmomRowIds, exerciseData, emomDurationMinutes, emomStepLabel, structureBlocks, setStructureBlocks, updateBlock]);

  return (
    <div className="space-y-6">
      <Card data-testid="structured-blocks-card">
        <CardHeader>
          <CardTitle className="text-lg">Structured blocks (EMOM, intervals, AMRAP…)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Use this for time-domain formats that don't fit into per-set rows.
          </p>
        </CardHeader>
        <CardContent>
          <StructureBlocksEditor value={structureBlocks} onChange={setStructureBlocks} />
        </CardContent>
      </Card>

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
              <div className="flex items-center justify-between gap-3">
                <span>Couldn’t fully structure this workout yet — review and fix.</span>
                <Button type="button" size="sm" variant="outline" onClick={focusManualTableEditor}>
                  Edit table manually
                </Button>
              </div>
            </div>
          )}

          {hasLegacyEmomRows && !conversionDone && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm" data-testid="confirm-step-legacy-emom-warning">
              <p className="font-medium text-destructive">Compatibility warning: legacy EMOM rows</p>
              <span>Older EMOM rows are supported for display/editing, but new EMOM should be saved as structured blocks.</span>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-xs">
                  Duration (min)
                  <input className="mt-1 w-full rounded border px-2 py-1" type="number" min={1} value={emomDurationMinutes} onChange={(e) => setEmomDurationMinutes(Number(e.target.value) || 1)} />
                </label>
                <label className="text-xs">
                  Step label
                  <input className="mt-1 w-full rounded border px-2 py-1" value={emomStepLabel} onChange={(e) => setEmomStepLabel(e.target.value)} />
                </label>
              </div>
              <Button type="button" size="sm" className="mt-2" onClick={handleConvertLegacyEmom}>
                Convert to EMOM block
              </Button>
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
            <Collapsible open={isLegacyNoteOpen} onOpenChange={handleLegacyNoteOpenChange}>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  data-testid="button-show-original"
                >
                  {isLegacyNoteOpen ? "Hide" : "View"} original description (legacy note)
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
