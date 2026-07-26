import { metersToUserDistance } from "@shared/unitConversion";
import { Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import type { MafTestMetricsInput } from "@/lib/api";
import {
  MAX_HEART_RATE,
  MIN_HEART_RATE,
  parseOptionalDistanceMeters,
  parseOptionalInt,
  validateManualMetrics,
} from "@/lib/manualMetrics";
import { formatSecondsToMmSs } from "@/lib/statsUtils";
import { parseDurationToSeconds } from "@/lib/workoutDuration";

/** Canonical metrics (meters, seconds, bpm) used to prefill the form. */
export interface MafTestFormInitial {
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

interface MafTestFormProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: "create" | "edit";
  readonly initial: MafTestFormInitial;
  readonly isPending: boolean;
  readonly onSubmit: (metrics: MafTestMetricsInput) => void;
  readonly testId?: string;
}

/** Convert canonical meters into a trimmed display-unit string for the input. */
function distanceToInput(distanceMeters: number | null, distanceUnit: string): string {
  if (distanceMeters == null) return "";
  return String(Number(metersToUserDistance(distanceMeters, distanceUnit).toFixed(3)));
}

/**
 * Dialog for entering or editing a MAF test's heart rate, duration, and
 * distance. Values are prefilled in (and submitted from) the athlete's display
 * units; conversion to canonical meters/seconds happens at this boundary so the
 * stored metrics stay unit-agnostic. Reused for both tagging (prefilled from the
 * workout) and editing (prefilled from the saved test).
 */
export function MafTestForm({
  open,
  onOpenChange,
  mode,
  initial,
  isPending,
  onSubmit,
  testId = "maf-test-form",
}: MafTestFormProps) {
  const { distanceUnit, distanceLabel } = useUnitPreferences();
  // Seed from the canonical metrics, converting distance into the athlete's
  // display unit and duration into mm:ss. The parent remounts this dialog (via a
  // changing `key`) each time it opens, so these initializers re-read the latest
  // `initial` rather than needing a setState-in-effect resync.
  const [avgHr, setAvgHr] = useState(initial.avgHeartRate == null ? "" : String(initial.avgHeartRate));
  const [maxHr, setMaxHr] = useState(initial.maxHeartRate == null ? "" : String(initial.maxHeartRate));
  const [duration, setDuration] = useState(
    initial.durationSeconds == null ? "" : formatSecondsToMmSs(initial.durationSeconds),
  );
  const [distance, setDistance] = useState(distanceToInput(initial.distanceMeters, distanceUnit));
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const metricsError = validateManualMetrics(distance, avgHr, maxHr, distanceUnit);
    if (metricsError) {
      setError(metricsError);
      return;
    }
    const durationTrimmed = duration.trim();
    const durationSeconds = durationTrimmed === "" ? null : parseDurationToSeconds(durationTrimmed);
    if (durationTrimmed !== "" && (durationSeconds == null || durationSeconds <= 0)) {
      setError("Enter duration as mm:ss — for example 28:30.");
      return;
    }
    onSubmit({
      avgHeartRate: parseOptionalInt(avgHr),
      maxHeartRate: parseOptionalInt(maxHr),
      durationSeconds,
      distanceMeters: parseOptionalDistanceMeters(distance, distanceUnit),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Tag as MAF test" : "Edit MAF test"}</DialogTitle>
          <DialogDescription>
            Enter the heart rate, duration, and distance for this run. Leave a field blank if you
            don&apos;t have it — an average heart rate is needed for a compliance score.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="maf-avg-hr">Avg heart rate (bpm)</Label>
              <Input
                id="maf-avg-hr"
                inputMode="numeric"
                value={avgHr}
                onChange={(e) => setAvgHr(e.target.value)}
                placeholder={`${MIN_HEART_RATE}–${MAX_HEART_RATE}`}
                data-testid={`${testId}-avg-hr`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maf-max-hr">Max heart rate (bpm)</Label>
              <Input
                id="maf-max-hr"
                inputMode="numeric"
                value={maxHr}
                onChange={(e) => setMaxHr(e.target.value)}
                placeholder="optional"
                data-testid={`${testId}-max-hr`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maf-duration">Duration (mm:ss)</Label>
              <Input
                id="maf-duration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="28:30"
                data-testid={`${testId}-duration`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maf-distance">Distance ({distanceLabel})</Label>
              <Input
                id="maf-distance"
                inputMode="decimal"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                placeholder="optional"
                data-testid={`${testId}-distance`}
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid={`${testId}-error`}>
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" data-testid={`${testId}-cancel`}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isPending} data-testid={`${testId}-submit`}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {mode === "create" ? "Tag as MAF test" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
