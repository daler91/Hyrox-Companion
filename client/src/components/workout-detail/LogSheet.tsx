import type { TimelineEntry } from "@shared/schema";
import { format, parseISO } from "date-fns";
import {
  Gauge,
  ListChecks,
  MessageSquare,
  Pencil,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import { RpeSelector } from "@/components/RpeSelector";
import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Separator } from "@/components/ui/separator";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { groupExerciseSets } from "@/lib/exerciseUtils";

import { ExerciseChips } from "../timeline/timeline-workout-card/ExerciseChips";

interface LogSheetProps {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
  /** Tier 1: log the workout exactly as prescribed, with an optional RPE override. */
  readonly onLogAsPlanned: (entry: TimelineEntry, rpe: number | null) => void;
  /** Tier 2 escape hatch — hands off to the legacy dialog's full editor. */
  readonly onEditDetails: (entry: TimelineEntry) => void;
  readonly onSkip?: (entry: TimelineEntry) => void;
  readonly onAskCoach?: (entry: TimelineEntry) => void;
  readonly isLogging?: boolean;
}

/**
 * Tier-1 log surface for today/past planned cards. Replaces the
 * 2,000-line WorkoutDetailDialogV2 for the common "I did the workout
 * basically as prescribed" path: one primary CTA + an inline RPE
 * picker. Per-exercise edits and free-text paste live behind
 * "Edit details…", which hands off to the legacy dialog until those
 * affordances are ported to a sheet-native editor.
 */
export function LogSheet({
  entry,
  onClose,
  onLogAsPlanned,
  onEditDetails,
  onSkip,
  onAskCoach,
  isLogging,
}: LogSheetProps) {
  const { distanceUnit, weightLabel } = useUnitPreferences();
  const [rpe, setRpe] = useState<number | null>(entry?.rpe ?? null);
  const [lastEntryId, setLastEntryId] = useState<string | null>(entry?.id ?? null);

  // Reseed RPE when a different entry opens the sheet — avoids carrying
  // a previous workout's RPE choice into the next one.
  if (entry && entry.id !== lastEntryId) {
    setLastEntryId(entry.id);
    setRpe(entry.rpe ?? null);
  }

  if (!entry) return null;

  const groupedExercises = entry.exerciseSets && entry.exerciseSets.length > 0
    ? groupExerciseSets(entry.exerciseSets)
    : [];

  const scheduled = (() => {
    try {
      return format(parseISO(entry.date), "EEEE, MMM d");
    } catch {
      return entry.date;
    }
  })();

  return (
    <ResponsiveSheet
      open={!!entry}
      onOpenChange={(open) => !open && onClose()}
      title={entry.focus || "Log workout"}
      description={scheduled}
      testId={`log-sheet-${entry.id}`}
    >
      <div className="space-y-4">
        {groupedExercises.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Prescribed
            </p>
            <ExerciseChips
              entryId={entry.id}
              groupedExercises={groupedExercises}
              workoutLogId={undefined}
              weightLabel={weightLabel}
              distanceUnit={distanceUnit}
            />
          </div>
        ) : entry.mainWorkout ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Prescribed
            </p>
            <p className="text-sm text-muted-foreground">{entry.mainWorkout}</p>
          </div>
        ) : null}

        {entry.accessory ? (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Accessory
            </p>
            <p className="text-sm text-muted-foreground">{entry.accessory}</p>
          </div>
        ) : null}

        {entry.aiRationale ? (
          <details className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <summary className="cursor-pointer text-xs font-medium text-primary">
              <Sparkles className="mr-1.5 inline h-3.5 w-3.5" />
              Why this workout
            </summary>
            <p className="mt-2 text-sm text-foreground/80">{entry.aiRationale}</p>
          </details>
        ) : null}

        <Separator />

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" />
            How hard? <span className="normal-case text-muted-foreground/70">(optional)</span>
          </p>
          <RpeSelector value={rpe} onChange={setRpe} showLabel={false} compact />
        </div>

        <div className="space-y-2">
          <Button
            className="w-full"
            size="lg"
            onClick={() => onLogAsPlanned(entry, rpe)}
            disabled={isLogging}
            data-testid={`log-as-planned-${entry.id}`}
          >
            <ListChecks className="mr-2 h-4 w-4" />
            {isLogging ? "Logging…" : "Log as planned"}
          </Button>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={() => onEditDetails(entry)}
              data-testid={`log-edit-details-${entry.id}`}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit details…
            </Button>
            {onAskCoach ? (
              <Button
                variant="outline"
                onClick={() => onAskCoach(entry)}
                data-testid={`log-ask-coach-${entry.id}`}
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                Ask coach
              </Button>
            ) : null}
            {onSkip ? (
              <Button
                variant="ghost"
                onClick={() => onSkip(entry)}
                data-testid={`log-skip-${entry.id}`}
              >
                <SkipForward className="mr-2 h-4 w-4" />
                Skip
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </ResponsiveSheet>
  );
}
