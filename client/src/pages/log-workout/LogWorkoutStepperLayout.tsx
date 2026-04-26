import type { ExerciseName, ParsedExercise } from "@shared/schema";
import { Check } from "lucide-react";

import type { StructuredExercise } from "@/components/ExerciseInput";
import { Button } from "@/components/ui/button";
import { WorkoutHeader } from "@/components/workout/WorkoutHeader";
import type { useToast } from "@/hooks/use-toast";
import type { WorkoutStep } from "@/hooks/useLogWorkoutDraft";
import type { ParseFromImagePayload } from "@/lib/api";
import { cn } from "@/lib/utils";

import { CaptureStep } from "./steps/CaptureStep";
import { ConfirmStep } from "./steps/ConfirmStep";
import { ReflectStep } from "./steps/ReflectStep";

interface LogWorkoutStepperLayoutProps {
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

export function LogWorkoutStepperLayout(props: LogWorkoutStepperLayoutProps) {
  const { step, setStep } = props;

  return (
    <div className="container max-w-3xl mx-auto p-4 pb-28 md:pb-8 pt-4 md:pt-8 min-h-screen">
      <WorkoutHeader
        onDuplicateLast={step === 1 ? props.handleDuplicateLast : undefined}
        isDuplicating={props.isDuplicating}
      />

      <StepIndicator current={step} onJump={setStep} />

      <div className="mt-6">
        {step === 1 && (
          <CaptureStep
            title={props.title}
            setTitle={props.setTitle}
            date={props.date}
            setDate={props.setDate}
            freeText={props.freeText}
            setFreeText={props.setFreeText}
            exerciseBlocks={props.exerciseBlocks}
            exerciseData={props.exerciseData}
            addExercise={props.addExercise}
            updateBlock={props.updateBlock}
            removeBlock={props.removeBlock}
            reorderBlocks={props.reorderBlocks}
            weightUnit={props.weightUnit}
            distanceUnit={props.distanceUnit}
            autoParsing={props.autoParsing}
            autoParseError={props.autoParseError}
            parseNow={props.parseNow}
            cancelAutoParse={props.cancelAutoParse}
            isListening={props.isListening}
            isSupported={props.isSupported}
            interimTranscript={props.interimTranscript}
            toggleListening={props.toggleListening}
            stopListening={props.stopListening}
            toast={props.toast}
            defaultPanelOpen={props.defaultPanelOpen}
            onParseImage={props.onParseImage}
            isParsingImage={props.isParsingImage}
            onCancel={props.handleCancel}
            onContinue={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <ConfirmStep
            freeText={props.freeText}
            exerciseBlocks={props.exerciseBlocks}
            exerciseData={props.exerciseData}
            addExercise={props.addExercise}
            updateBlock={props.updateBlock}
            removeBlock={props.removeBlock}
            reorderBlocks={props.reorderBlocks}
            weightUnit={props.weightUnit}
            distanceUnit={props.distanceUnit}
            autoParsing={props.autoParsing}
            onBack={() => setStep(1)}
            onContinue={() => setStep(3)}
          />
        )}

        {step === 3 && (
          <ReflectStep
            rpe={props.rpe}
            setRpe={props.setRpe}
            notes={props.notes}
            setNotes={props.setNotes}
            isNotesListening={props.isNotesListening}
            isNotesSupported={props.isNotesSupported}
            notesInterim={props.notesInterim}
            toggleNotesListening={props.toggleNotesListening}
            onBack={() => setStep(2)}
            handleSave={props.handleSave}
            isSaving={props.isSaving}
            hasWorkoutDetails={props.hasWorkoutDetails}
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
