import type { TimelineEntry } from "@shared/schema";
import {
  ListChecks,
  MessageSquare,
  Sparkles,
  SkipForward,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Separator } from "@/components/ui/separator";
import { usePlanDayExercises } from "@/hooks/usePlanDayExercises";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";

import { ExerciseTable } from "./ExerciseTable";
import { SaveStatePill } from "./SaveStatePill";
import { PrescriptionEditor } from "./shared/PrescriptionEditor";
import { RpePrompt } from "./shared/RpePrompt";
import { WorkoutPrescriptionSummary } from "./shared/WorkoutPrescriptionSummary";

interface LogSheetProps {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
  /** Tier 1: log the workout exactly as prescribed, with an optional RPE override. */
  readonly onLogAsPlanned: (entry: TimelineEntry, rpe: number | null) => void;
  readonly onSkip?: (entry: TimelineEntry) => void;
  readonly onAskCoach?: (entry: TimelineEntry) => void;
  readonly isLogging?: boolean;
}

/**
 * Sheet-native log surface for today/past planned cards. Single-tier:
 * the prescription editor is inline (no disclosure tap) so per-set
 * tweaks are one tap away. Wired to usePlanDayExercises mutations so
 * edits autosave before the log mutation copies them into a
 * workoutLog. The free-text/photo "Replace prescription" affordance
 * stays in PrescriptionEditor (self-collapsed when sets exist) since
 * it's destructive and rarely needed for normal logging.
 */
export function LogSheet({
  entry,
  onClose,
  onLogAsPlanned,
  onSkip,
  onAskCoach,
  isLogging,
}: LogSheetProps) {
  const { weightUnit: prefWeightUnit, distanceUnit } = useUnitPreferences();
  const weightUnit: "kg" | "lb" = prefWeightUnit === "kg" ? "kg" : "lb";
  const [rpe, setRpe] = useState<number | null>(entry?.rpe ?? null);
  const [lastEntryId, setLastEntryId] = useState<string | null>(entry?.id ?? null);

  const planSets = usePlanDayExercises(entry?.planDayId ?? null);

  // Reseed transient state when a different entry opens the sheet so we
  // don't carry one workout's RPE into the next.
  if (entry && entry.id !== lastEntryId) {
    setLastEntryId(entry.id);
    setRpe(entry.rpe ?? null);
  }

  if (!entry) return null;

  const handleLog = async () => {
    // Flush any debounced cell edits before the log mutation runs — the
    // server's createWorkoutInTx copies persisted plan-day rows into
    // the new workoutLog, so a row edit still queued in the debounce
    // coordinator would be missing from the snapshot.
    await planSets.flushPendingSetPatches();
    onLogAsPlanned(entry, rpe);
  };

  const parseBlocked = !!entry.planDayId && planSets.parseFailed && planSets.exerciseSets.length === 0;
  const logButtonLabel = planSets.isSaving ? "Saving edits…" : isLogging ? "Logging…" : "Log as planned";
  const showAskCoach = !!onAskCoach;
  const showSkip = !!onSkip;

  return (
    <ResponsiveSheet
      open={!!entry}
      onOpenChange={(open) => !open && onClose()}
      title={entry.focus || "Log workout"}
      description={formatScheduledDate(entry.date)}
      contentClassName="sm:max-w-2xl"
      testId={`log-sheet-${entry.id}`}
    >
      <div className="space-y-4">
        {entry.planDayId ? (
          <>
            {entry.aiRationale ? (
              <details className="rounded-md border border-primary/30 bg-primary/5 p-3">
                <summary className="cursor-pointer text-xs font-medium text-primary">
                  <Sparkles className="mr-1.5 inline h-3.5 w-3.5" />
                  Why this workout
                </summary>
                <p className="mt-2 text-sm text-foreground/80">{entry.aiRationale}</p>
              </details>
            ) : null}

            {entry.accessory ? (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Accessory
                </p>
                <p className="text-sm text-muted-foreground">{entry.accessory}</p>
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Prescription
                </p>
                <SaveStatePill
                  state={{ isSaving: planSets.isSaving, lastSavedAt: planSets.lastSavedAt }}
                  testId={`log-edit-save-state-${entry.id}`}
                />
              </div>
              <ExerciseTable
                workoutId={entry.planDayId}
                exerciseSets={planSets.exerciseSets}
                weightUnit={weightUnit}
                distanceUnit={distanceUnit}
                onUpdateSet={planSets.patchSetDebounced}
                onAddSet={planSets.addSet.mutate}
                onDeleteSet={planSets.deleteSet.mutate}
                saveState={{
                  isSaving: planSets.isSaving,
                  lastSavedAt: planSets.lastSavedAt,
                }}
                onOpenConversionHelper={() => planSets.reparseFreeText.mutate(undefined)}
                defaultExpanded
              />
              {parseBlocked ? (
                <div
                  className="rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                  role="alert"
                  data-testid={`log-parse-failed-${entry.id}`}
                >
                  <p>Parse failed; workout cannot be saved as text-only.</p>
                  {planSets.retryParse ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto p-0 text-amber-900"
                      onClick={planSets.retryParse}
                      data-testid={`log-parse-retry-${entry.id}`}
                    >
                      Retry parse
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <PrescriptionEditor
                entryId={entry.id}
                hasSets={planSets.exerciseSets.length > 0}
                mainWorkout={entry.mainWorkout}
                accessory={entry.accessory}
                notes={entry.notes}
                onSaveField={(field, value) =>
                  planSets.updatePrescription.mutate({
                    [field]: value.trim().length === 0 ? null : value,
                  })
                }
                onParseText={() => planSets.reparseFreeText.mutate(undefined)}
                onParseImage={(payload) => planSets.reparseFromImage.mutate(payload)}
                isParsingText={planSets.reparseFreeText.isPending}
                isParsingImage={planSets.reparseFromImage.isPending}
                title="Coach's text / photo"
                compact
              />
            </div>
          </>
        ) : (
          <WorkoutPrescriptionSummary entry={entry} rationaleVariant="collapsed" />
        )}

        <Separator />

        <RpePrompt value={rpe} onChange={setRpe} />

        <div className="space-y-2">
          <Button
            type="button"
            className="w-full"
            size="lg"
            onClick={handleLog}
            disabled={isLogging || planSets.isSaving || parseBlocked}
            data-testid={`log-as-planned-${entry.id}`}
          >
            <ListChecks className="mr-2 h-4 w-4" />
            {logButtonLabel}
          </Button>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {showAskCoach ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => onAskCoach?.(entry)}
                data-testid={`log-ask-coach-${entry.id}`}
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                Ask coach
              </Button>
            ) : null}
            {showSkip ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => onSkip?.(entry)}
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
