import type { AllowedImageMimeType, ExerciseName, ParsedExercise } from "@shared/schema";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { StructuredExercise } from "@/components/ExerciseInput";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DraftExerciseTable } from "@/components/workout/DraftExerciseTable";
import { WorkoutTextMode } from "@/components/workout/WorkoutTextMode";
import type { toast as toastFn } from "@/hooks/use-toast";
import type { ParseFromImagePayload } from "@/lib/api";
import type { CompressedImage } from "@/lib/image";
import { cn } from "@/lib/utils";

interface WorkoutComposerProps {
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

  /** Parse control surfaced from useWorkoutEditor. */
  readonly autoParsing: boolean;
  readonly autoParseError: boolean;
  /**
   * Fires a parse immediately (no debounce). Wired to the explicit
   * Parse button in the text panel — text-change no longer auto-parses.
   */
  readonly parseNow: (text: string) => void;
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

  /**
   * Image-parse pipeline. The caller is responsible for invoking the
   * parseImageMutation; this component only orchestrates capture + preview.
   * The `opts.onSuccess` callback fires AFTER the mutation resolves so the
   * composer can revoke the object URL and clear the preview without
   * lifting preview state up to LogWorkout. The mutation's resolved data
   * is forwarded so the composer can distinguish a real parse from an
   * empty-result "no exercises found" soft failure — in the latter case
   * the preview must stay so the user can retake/retry.
   */
  readonly onParseImage?: (
    payload: ParseFromImagePayload,
    opts?: { onSuccess?: (parsed: ParsedExercise[]) => void },
  ) => void;
  readonly isParsingImage?: boolean;
}

/**
 * Unified input surface for the Log Workout page. Structured exercises
 * are the long-term source of truth; the free-text area sits inside a
 * collapsible panel whose contents are parsed into the exercise list
 * only when the user clicks the Parse button. Voice dictation flows
 * into the same text panel.
 *
 * A pending parse is cancelled the moment the user edits a block so an
 * in-flight parse doesn't overwrite their in-progress edits.
 */
export function WorkoutComposer({
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
}: WorkoutComposerProps) {
  const [imagePreview, setImagePreview] = useState<{
    url: string;
    base64: string;
    mimeType: AllowedImageMimeType;
  } | null>(null);

  // Mirror the active preview URL into a ref so a single unmount-only
  // cleanup effect can revoke it without re-running on every preview swap
  // (the swap paths — Retake, success, replace-on-recapture — already
  // revoke the previous URL synchronously). Without this, a user who
  // captures and then navigates away leaks the underlying Blob until the
  // tab is closed.
  const previewUrlRef = useRef<string | null>(null);
  useEffect(() => {
    previewUrlRef.current = imagePreview?.url ?? null;
  }, [imagePreview?.url]);
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);
  const [panelOpen, setPanelOpen] = useState(
    () => defaultPanelOpen ?? freeText.trim().length > 0,
  );
  // Reconcile panel visibility with external changes to `freeText`.
  // The panel can only receive typed input while it's open — anything
  // that mutates `freeText` while we're collapsed is necessarily an
  // external injection (duplicate-last's "mainWorkout" fallback path,
  // voice start from a stashed state, etc.). Expand so the user sees
  // where their input landed instead of leaving a silent textarea
  // behind a closed panel. Using render-time reconciliation avoids a
  // setState-in-effect the hook rule would flag.
  const [lastSeenText, setLastSeenText] = useState(freeText);
  if (freeText !== lastSeenText) {
    setLastSeenText(freeText);
    if (!panelOpen && freeText.trim().length > 0) {
      setPanelOpen(true);
    }
  }

  // Touching a block cancels any pending parse so the user's edit
  // isn't clobbered by a parse that was dispatched before they focused
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
    (name: ExerciseName, customLabel?: string) => {
      cancelAutoParse();
      addExercise(name, customLabel);
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

  const hasDescription = freeText.trim().length > 0;

  return (
    <div className="space-y-4" data-testid="workout-composer">
      <ParseStatusStrip
        parsing={autoParsing}
        error={autoParseError}
        hasText={hasDescription}
      />

      <WorkoutContentsStatus
        exerciseCount={exerciseBlocks.length}
        hasDescription={hasDescription}
      />

      <Collapsible open={panelOpen} onOpenChange={handlePanelOpenChange}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full justify-between px-3"
            data-testid="workout-composer-toggle-text"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden />
              Description, voice, or photo
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
            onParseText={() => parseNow(freeText)}
            isParsingText={autoParsing}
            onCaptureImage={
              onParseImage
                ? (img: CompressedImage) => {
                    if (imagePreview) URL.revokeObjectURL(imagePreview.url);
                    setImagePreview({
                      url: img.previewUrl,
                      base64: img.base64,
                      mimeType: img.mimeType,
                    });
                  }
                : undefined
            }
            imagePreview={imagePreview ? { url: imagePreview.url } : null}
            onRetakeImage={() => {
              if (imagePreview) URL.revokeObjectURL(imagePreview.url);
              setImagePreview(null);
            }}
            onParseImage={
              onParseImage
                ? () => {
                    if (!imagePreview) return;
                    // Cancel any queued / in-flight text auto-parse first.
                    // Without this, a debounced text parse from recent
                    // freeText edits can land after the image parse and
                    // overwrite the image-derived blocks (which don't
                    // carry hasUserEdits, so mergeParsedWithEdits treats
                    // them as replaceable).
                    cancelAutoParse();
                    const capturedPreview = imagePreview;
                    onParseImage(
                      {
                        imageBase64: capturedPreview.base64,
                        mimeType: capturedPreview.mimeType,
                      },
                      {
                        onSuccess: (parsed) => {
                          // Soft-failure guard: parseFromImage resolves
                          // successfully with parsed.length === 0 when
                          // Gemini extracted nothing. Keep the preview
                          // so the user can retake/retry without losing
                          // the capture.
                          if (!parsed || parsed.length === 0) return;
                          URL.revokeObjectURL(capturedPreview.url);
                          setImagePreview((current) =>
                            current?.url === capturedPreview.url ? null : current,
                          );
                        },
                      },
                    );
                  }
                : undefined
            }
            isParsingImage={isParsingImage}
          />
        </CollapsibleContent>
      </Collapsible>

      <DraftExerciseTable
        exerciseBlocks={exerciseBlocks}
        exerciseData={exerciseData}
        addExercise={handleAddExercise}
        updateBlock={handleUpdateBlock}
        removeBlock={handleRemoveBlock}
        reorderBlocks={reorderBlocks}
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
      />
    </div>
  );
}

interface WorkoutContentsStatusProps {
  readonly exerciseCount: number;
  readonly hasDescription: boolean;
}

function WorkoutContentsStatus({ exerciseCount, hasDescription }: WorkoutContentsStatusProps) {
  let label = "Empty";
  let detail = "Add exercise rows or a description";
  if (exerciseCount > 0) {
    label = `${exerciseCount} exercise${exerciseCount === 1 ? "" : "s"}`;
    detail = hasDescription ? "Structured rows with source text" : "Structured rows ready";
  } else if (hasDescription) {
    label = "Description captured";
    detail = "No exercise rows yet";
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
      role="status"
      aria-live="polite"
      data-testid="workout-contents-status"
    >
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase text-muted-foreground">
          Workout contents
        </div>
        <div className="truncate font-medium">{label}</div>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {exerciseCount > 0 ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
        ) : null}
        <span>{detail}</span>
      </div>
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
