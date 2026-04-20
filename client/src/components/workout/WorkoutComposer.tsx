import type { ExerciseName } from "@shared/schema";
import { AlertTriangle, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { StructuredExercise } from "@/components/ExerciseInput";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { WorkoutExerciseMode } from "@/components/workout/WorkoutExerciseMode";
import { WorkoutTextMode } from "@/components/workout/WorkoutTextMode";
import type { toast as toastFn } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface WorkoutComposerProps {
  readonly freeText: string;
  readonly setFreeText: (value: string) => void;
  readonly exerciseBlocks: string[];
  readonly exerciseData: Record<string, StructuredExercise>;
  readonly addExercise: (name: ExerciseName) => void;
  readonly updateBlock: (blockId: string, data: StructuredExercise) => void;
  readonly removeBlock: (blockId: string) => void;
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";

  /** Auto-parse control surfaced from useWorkoutEditor. */
  readonly autoParsing: boolean;
  readonly autoParseError: boolean;
  readonly scheduleAutoParse: (text: string) => void;
  readonly cancelAutoParse: () => void;

  /** Voice input for dictating into the text panel. */
  readonly isListening: boolean;
  readonly isSupported: boolean;
  readonly interimTranscript: string;
  readonly toggleListening: () => void;
  readonly stopListening: () => void;

  readonly toast: typeof toastFn;
  /**
   * When true, the "Describe / dictate" panel starts expanded. Typical
   * callers set this to true while there's restored free-text draft
   * content so the user sees where their input is held.
   */
  readonly defaultPanelOpen?: boolean;
}

/**
 * Unified input surface for the Log Workout page. Structured exercises
 * are the long-term source of truth; the free-text area sits inside a
 * collapsible panel whose contents get parsed into the exercise list on
 * a debounce. Voice dictation flows into the same text panel.
 *
 * Auto-parse is cancelled the moment the user edits a parsed block so
 * a fresh parse doesn't overwrite their in-progress edits. Re-entering
 * the text field (or changing its value) re-primes the debounce.
 */
export function WorkoutComposer({
  freeText,
  setFreeText,
  exerciseBlocks,
  exerciseData,
  addExercise,
  updateBlock,
  removeBlock,
  weightUnit,
  distanceUnit,
  autoParsing,
  autoParseError,
  scheduleAutoParse,
  cancelAutoParse,
  isListening,
  isSupported,
  interimTranscript,
  toggleListening,
  stopListening,
  toast,
  defaultPanelOpen,
}: WorkoutComposerProps) {
  const [panelOpen, setPanelOpen] = useState(
    () => defaultPanelOpen ?? freeText.trim().length > 0,
  );

  // Whenever the free-text changes, re-prime the auto-parse debounce.
  // The editor hook handles dedup (skips unchanged text) and abort on
  // subsequent calls so we don't need to gate here.
  useEffect(() => {
    scheduleAutoParse(freeText);
  }, [freeText, scheduleAutoParse]);

  // Touching a block cancels any pending auto-parse so the user's edit
  // isn't clobbered by a parse that was debounced before they focused
  // the stepper.
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

  const handleAddExercise = useCallback(
    (name: ExerciseName) => {
      cancelAutoParse();
      addExercise(name);
    },
    [cancelAutoParse, addExercise],
  );

  // Collapsing the panel hides the dictation controls (stop button +
  // listening indicator live inside CollapsibleContent), so if voice
  // capture is active when the user hides the panel we'd keep
  // recording invisibly and silently pipe transcripts into freeText.
  // Stop the recognition when the panel closes so the user always sees
  // the state that's actually running.
  const handlePanelOpenChange = useCallback(
    (open: boolean) => {
      if (!open && isListening) stopListening();
      setPanelOpen(open);
    },
    [isListening, stopListening],
  );

  return (
    <div className="space-y-4" data-testid="workout-composer">
      <ParseStatusStrip
        parsing={autoParsing}
        error={autoParseError}
        hasText={freeText.trim().length > 0}
      />

      <Collapsible open={panelOpen} onOpenChange={handlePanelOpenChange}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between"
            data-testid="workout-composer-toggle-text"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden />
              Describe or dictate your workout
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                panelOpen && "rotate-180",
              )}
              aria-hidden
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <WorkoutTextMode
            freeText={freeText}
            setFreeText={setFreeText}
            isListening={isListening}
            isSupported={isSupported}
            toggleListening={toggleListening}
            stopListening={stopListening}
            interimTranscript={interimTranscript}
            toast={toast}
          />
        </CollapsibleContent>
      </Collapsible>

      <WorkoutExerciseMode
        exerciseBlocks={exerciseBlocks}
        exerciseData={exerciseData}
        addExercise={handleAddExercise}
        updateBlock={handleUpdateBlock}
        removeBlock={handleRemoveBlock}
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
      />
    </div>
  );
}

interface ParseStatusStripProps {
  readonly parsing: boolean;
  readonly error: boolean;
  readonly hasText: boolean;
}

function ParseStatusStrip({ parsing, error, hasText }: ParseStatusStripProps) {
  if (parsing) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary"
        role="status"
        aria-live="polite"
        data-testid="composer-parsing"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Parsing your description into exercises…
      </div>
    );
  }
  if (error && hasText) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
        role="status"
        aria-live="polite"
        data-testid="composer-parse-error"
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        Couldn't auto-parse. Keep typing or add exercises manually below.
      </div>
    );
  }
  return null;
}
