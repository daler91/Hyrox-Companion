import type { ParsedExercise } from "@shared/schema";
import { Check } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { WorkoutHeader } from "@/components/workout/WorkoutHeader";
import type { useToast } from "@/hooks/use-toast";
import type { WorkoutStep } from "@/hooks/useLogWorkoutDraft";
import type { ParseFromImagePayload } from "@/lib/api";
import { cn } from "@/lib/utils";

import { shouldTriggerParseOnContinue } from "./parseCheckpoint";
import type { SharedComposerProps } from "./sharedComposerProps";
import { CaptureStep } from "./steps/CaptureStep";
import { ConfirmStep } from "./steps/ConfirmStep";
import { ReflectStep } from "./steps/ReflectStep";

interface LogWorkoutStepperLayoutProps extends SharedComposerProps {
  readonly parseNow: (text: string) => void;
  readonly step: WorkoutStep;
  readonly setStep: (step: WorkoutStep) => void;
  readonly title: string;
  readonly setTitle: (value: string) => void;
  readonly date: string;
  readonly setDate: (value: string) => void;
  readonly rpe: number | null;
  readonly setRpe: (value: number | null) => void;
  readonly notes: string;
  readonly setNotes: (value: string) => void;
  readonly isNotesListening: boolean;
  readonly isNotesSupported: boolean;
  readonly notesInterim: string;
  readonly toggleNotesListening: () => void;
  readonly handleSave: () => void;
  readonly isSaving: boolean;
  readonly handleCancel: () => void;
  readonly hasWorkoutDetails: boolean;
  readonly handleDuplicateLast: () => void;
  readonly isDuplicating: boolean;
  readonly defaultPanelOpen?: boolean;
  readonly toast: ReturnType<typeof useToast>["toast"];
  readonly onParseImage: (
    payload: ParseFromImagePayload,
    opts?: { onSuccess?: (parsed: ParsedExercise[]) => void },
  ) => void;
  readonly isParsingImage: boolean;
}

const STEP_LABELS: Record<WorkoutStep, string> = {
  1: "Capture",
  2: "Confirm",
  3: "Reflect",
};

export function LogWorkoutStepperLayout({
  step,
  setStep,
  title,
  setTitle,
  date,
  setDate,
  rpe,
  setRpe,
  notes,
  setNotes,
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
  isNotesListening,
  isNotesSupported,
  notesInterim,
  toggleNotesListening,
  handleSave,
  isSaving,
  handleCancel,
  hasWorkoutDetails,
  handleDuplicateLast,
  isDuplicating,
  defaultPanelOpen,
  toast,
  onParseImage,
  isParsingImage,
}: LogWorkoutStepperLayoutProps) {
  // Parse-checkpoint state lives here (above CaptureStep) so it survives
  // CaptureStep unmounting on step transitions. Returning to Capture after
  // an in-flight parse fails would otherwise reseed the ref to the edited
  // text and skip the next re-parse, persisting stale blocks (Codex P1).
  const lastParsedTextRef = useRef("");
  const pendingParseTextRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoParsing && !autoParseError && pendingParseTextRef.current !== null) {
      lastParsedTextRef.current = pendingParseTextRef.current;
      pendingParseTextRef.current = null;
    }
  }, [autoParsing, autoParseError]);

  const advanceFromCapture = () => {
    const needsParse = shouldTriggerParseOnContinue({
      freeText,
      lastParsedText: lastParsedTextRef.current,
      hasBlocks: exerciseBlocks.length > 0,
    });
    if (needsParse) {
      pendingParseTextRef.current = freeText;
      parseNow(freeText);
    }
    setStep(2);
  };

  // Shared props passed to both CaptureStep (which forwards them to
  // WorkoutComposer) and ConfirmStep (which forwards them to DraftExerciseTable).
  const exerciseTableProps = {
    exerciseBlocks,
    exerciseData,
    addExercise,
    updateBlock,
    removeBlock,
    reorderBlocks,
    weightUnit,
    distanceUnit,
    autoParsing,
    cancelAutoParse,
  };

  return (
    <div className="container max-w-3xl mx-auto p-4 pb-28 md:pb-8 pt-4 md:pt-8 min-h-screen">
      <WorkoutHeader
        onDuplicateLast={step === 1 ? handleDuplicateLast : undefined}
        isDuplicating={isDuplicating}
      />

      <StepIndicator current={step} onJump={setStep} />

      <div className="mt-6">
        {step === 1 && (
          <CaptureStep
            title={title}
            setTitle={setTitle}
            date={date}
            setDate={setDate}
            freeText={freeText}
            setFreeText={setFreeText}
            {...exerciseTableProps}
            autoParseError={autoParseError}
            isListening={isListening}
            isSupported={isSupported}
            interimTranscript={interimTranscript}
            toggleListening={toggleListening}
            stopListening={stopListening}
            toast={toast}
            defaultPanelOpen={defaultPanelOpen}
            onParseImage={onParseImage}
            isParsingImage={isParsingImage}
            onCancel={handleCancel}
            onContinue={advanceFromCapture}
          />
        )}

        {step === 2 && (
          <ConfirmStep
            freeText={freeText}
            {...exerciseTableProps}
            onBack={() => setStep(1)}
            onContinue={() => setStep(3)}
          />
        )}

        {step === 3 && (
          <ReflectStep
            rpe={rpe}
            setRpe={setRpe}
            notes={notes}
            setNotes={setNotes}
            isNotesListening={isNotesListening}
            isNotesSupported={isNotesSupported}
            notesInterim={notesInterim}
            toggleNotesListening={toggleNotesListening}
            onBack={() => setStep(2)}
            handleSave={handleSave}
            isSaving={isSaving}
            hasWorkoutDetails={hasWorkoutDetails}
          />
        )}
      </div>
    </div>
  );
}

interface StepIndicatorProps {
  readonly current: WorkoutStep;
  readonly onJump: (step: WorkoutStep) => void;
}

function StepIndicator({ current, onJump }: StepIndicatorProps) {
  const steps: WorkoutStep[] = [1, 2, 3];
  return (
    <ol
      className="flex items-center gap-2"
      aria-label="Workout logging progress"
      data-testid="stepper-indicator"
    >
      {steps.map((s, idx) => {
        const isActive = s === current;
        const isDone = s < current;
        // Allow jumping back, but not forward — forward must go through the
        // step's Continue button so any per-step side-effects (parsing,
        // validation) actually run.
        const canJump = s < current;
        return (
          <li key={s} className="flex items-center gap-2 flex-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={canJump ? () => onJump(s) : undefined}
              disabled={!canJump && !isActive}
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "flex w-full items-center gap-2 justify-start px-2 py-1.5 h-auto rounded-md",
                isActive && "bg-primary/10 text-primary",
                isDone && "text-muted-foreground",
              )}
              data-testid={`stepper-step-${s}`}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  isActive && "bg-primary text-primary-foreground",
                  isDone && "bg-muted text-muted-foreground",
                  !isActive && !isDone && "border border-border text-muted-foreground",
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" aria-hidden /> : s}
              </span>
              <span className="text-sm font-medium">{STEP_LABELS[s]}</span>
            </Button>
            {idx < steps.length - 1 && (
              <span
                className={cn(
                  "h-px flex-1 bg-border",
                  isDone && "bg-primary/40",
                )}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
