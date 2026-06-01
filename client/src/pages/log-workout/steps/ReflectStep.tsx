import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useState } from "react";

import { RpeSelector } from "@/components/RpeSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkoutNotesCard } from "@/components/workout/WorkoutNotesCard";
import { WorkoutPlanDayPicker } from "@/components/workout-detail/shared/WorkoutPlanDayPicker";

import { StepFooter } from "../StepFooter";

interface ReflectStepProps {
  readonly rpe: number | null;
  readonly setRpe: (value: number | null) => void;
  readonly durationMinutes: string;
  readonly setDurationMinutes: (value: string) => void;
  readonly distance: string;
  readonly setDistance: (value: string) => void;
  readonly avgHeartrate: string;
  readonly setAvgHeartrate: (value: string) => void;
  readonly maxHeartrate: string;
  readonly setMaxHeartrate: (value: string) => void;
  readonly distanceLabel: string;
  readonly planId: string | null;
  readonly setPlanId: (value: string | null) => void;
  readonly planDayId: string | null;
  readonly setPlanDayId: (value: string | null) => void;
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
  durationMinutes,
  setDurationMinutes,
  distance,
  setDistance,
  avgHeartrate,
  setAvgHeartrate,
  maxHeartrate,
  setMaxHeartrate,
  distanceLabel,
  planId,
  setPlanId,
  planDayId,
  setPlanDayId,
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
  // Explain why Save is disabled rather than leaving a dead button
  // (WCAG 3.3.2 / 3.3.1). Suppressed while a save is in flight.
  let saveBlockedReason: string | null = null;
  if (!isSaving) {
    if (!hasWorkoutDetails) {
      saveBlockedReason = "Add workout details on the previous step before saving.";
    } else if (!rpeOk) {
      saveBlockedReason = 'Rate your effort above, or tap "Skip RPE", to save.';
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">How hard was that?</CardTitle>
          <p className="text-sm text-muted-foreground">
            Rate of Perceived Exertion. 1 is barely working, 10 is maximum effort.
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
              {rpeSkipped
                ? "RPE skipped — you can still pick one above"
                : "Skip RPE for this workout"}
            </button>
          )}
          <div className="space-y-2 pt-3">
            <Label htmlFor="workout-duration-minutes">Total time (minutes)</Label>
            <Input
              id="workout-duration-minutes"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              placeholder="45"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value)}
              data-testid="input-duration-minutes"
            />
          </div>
          <div className="space-y-2 pt-3">
            <Label htmlFor="workout-distance">Distance ({distanceLabel})</Label>
            <Input
              id="workout-distance"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              placeholder={distanceLabel === "miles" ? "3.1" : "5"}
              value={distance}
              onChange={(event) => setDistance(event.target.value)}
              data-testid="input-distance"
            />
          </div>
          <div className="space-y-2 pt-3">
            <Label htmlFor="workout-avg-heartrate">Average heart rate (bpm)</Label>
            <Input
              id="workout-avg-heartrate"
              type="number"
              inputMode="numeric"
              min={20}
              max={250}
              step={1}
              placeholder="145"
              value={avgHeartrate}
              onChange={(event) => setAvgHeartrate(event.target.value)}
              data-testid="input-avg-heartrate"
            />
          </div>
          <div className="space-y-2 pt-3">
            <Label htmlFor="workout-max-heartrate">Max heart rate (bpm)</Label>
            <Input
              id="workout-max-heartrate"
              type="number"
              inputMode="numeric"
              min={20}
              max={250}
              step={1}
              placeholder="178"
              value={maxHeartrate}
              onChange={(event) => setMaxHeartrate(event.target.value)}
              data-testid="input-max-heartrate"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Connect to a plan</CardTitle>
          <p className="text-sm text-muted-foreground">
            Optionally link this workout to a scheduled plan day so it counts toward your plan.
          </p>
        </CardHeader>
        <CardContent>
          <WorkoutPlanDayPicker
            planId={planId}
            planDayId={planDayId}
            onChange={(next) => {
              setPlanId(next.planId);
              setPlanDayId(next.planDayId);
            }}
            idPrefix="log-plan"
          />
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

      {saveBlockedReason && (
        <output
          id="reflect-save-hint"
          className="block text-center text-xs text-muted-foreground"
          data-testid="text-save-blocked-reason"
        >
          {saveBlockedReason}
        </output>
      )}

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
          aria-describedby={saveBlockedReason ? "reflect-save-hint" : undefined}
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
