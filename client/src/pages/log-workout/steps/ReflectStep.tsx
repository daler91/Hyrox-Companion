import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useState } from "react";

import { RpeSelector } from "@/components/RpeSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkoutNotesCard } from "@/components/workout/WorkoutNotesCard";

import { StepFooter } from "../StepFooter";

interface ReflectStepProps {
  readonly rpe: number | null;
  readonly setRpe: (value: number | null) => void;
  readonly notes: string;
  readonly setNotes: (value: string) => void;
  readonly isNotesListening: boolean;
  readonly isNotesSupported: boolean;
  readonly notesInterim: string;
  readonly toggleNotesListening: () => void;
  readonly onBack: () => void;
  readonly handleSave: () => void;
  readonly isSaving: boolean;
  readonly hasWorkoutDetails: boolean;
}

/**
 * Step 3: Post-workout reflection. RPE is required to save by default —
 * users can opt out via the "skip RPE" link, but the friction is intentional
 * to drive better data quality. Saving here is the only commit point in the
 * stepper flow.
 */
export function ReflectStep({
  rpe,
  setRpe,
  notes,
  setNotes,
  isNotesListening,
  isNotesSupported,
  notesInterim,
  toggleNotesListening,
  onBack,
  handleSave,
  isSaving,
  hasWorkoutDetails,
}: ReflectStepProps) {
  const [rpeSkipped, setRpeSkipped] = useState(false);
  const rpeOk = rpe !== null || rpeSkipped;
  const canSave = hasWorkoutDetails && rpeOk && !isSaving;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">How hard was that?</CardTitle>
          <p className="text-sm text-muted-foreground">
            Rate of Perceived Exertion. 1 is barely working, 10 is maximum
            effort.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <RpeSelector value={rpe} onChange={setRpe} showLabel={false} />
          {rpe === null && (
            <button
              type="button"
              onClick={() => setRpeSkipped(true)}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              data-testid="button-skip-rpe"
            >
              {rpeSkipped ? "RPE skipped — you can still pick one above" : "Skip RPE for this workout"}
            </button>
          )}
        </CardContent>
      </Card>

      <WorkoutNotesCard
        notes={notes}
        setNotes={setNotes}
        isNotesListening={isNotesListening}
        isNotesSupported={isNotesSupported}
        toggleNotesListening={toggleNotesListening}
        notesInterim={notesInterim}
      />

      <StepFooter>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={onBack}
          disabled={isSaving}
          data-testid="button-step-back"
          className="flex-1 sm:flex-none"
        >
          <ArrowLeft className="h-4 w-4 mr-2" aria-hidden />
          Back
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={handleSave}
          disabled={!canSave}
          data-testid="button-save-workout"
          className="flex-1 sm:flex-none sm:min-w-40 shadow-lg"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4 mr-2" aria-hidden />
          )}
          {isSaving ? "Saving..." : "Save Workout"}
        </Button>
      </StepFooter>
    </div>
  );
}

