import type { TimelineEntry } from "@shared/schema";
import {
  ChevronDown,
  Gauge,
  ListChecks,
  MessageSquare,
  Pencil,
  SkipForward,
} from "lucide-react";
import { useState } from "react";

import { RpeSelector } from "@/components/RpeSelector";
import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Separator } from "@/components/ui/separator";
import { usePlanDayExercises } from "@/hooks/usePlanDayExercises";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";
import { cn } from "@/lib/utils";

import { ExerciseTable } from "./ExerciseTable";
import { SaveStatePill } from "./SaveStatePill";
import { PrescriptionEditor } from "./shared/PrescriptionEditor";
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
 * Sheet-native log surface for today/past planned cards. Replaces the
 * 2,000-line WorkoutDetailDialogV2 for the common path:
 *  - Tier 1: one-tap "Log as planned" with an optional RPE pick.
 *  - Tier 2: inline "Edit prescription" disclosure that mounts the
 *    same ExerciseTable as the legacy dialog, wired to
 *    usePlanDayExercises mutations so per-set tweaks autosave to the
 *    plan day before the log mutation copies them into a workoutLog.
 *
 * Free-text paste / image upload still live in the legacy dialog —
 * those affordances need the parse-confirm flow which is its own
 * port and out of scope for Slice 2.
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [lastEntryId, setLastEntryId] = useState<string | null>(entry?.id ?? null);

  const planSets = usePlanDayExercises(entry?.planDayId ?? null);

  // Reseed transient state when a different entry opens the sheet so we
  // don't carry one workout's RPE / open editor into the next.
  if (entry && entry.id !== lastEntryId) {
    setLastEntryId(entry.id);
    setRpe(entry.rpe ?? null);
    setEditorOpen(false);
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
        <WorkoutPrescriptionSummary entry={entry} rationaleVariant="collapsed" />

        <Separator />

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" />
            How hard? <span className="normal-case text-muted-foreground/70">(optional)</span>
          </p>
          <RpeSelector value={rpe} onChange={setRpe} showLabel={false} compact />
        </div>

        {entry.planDayId ? (
          <div className="rounded-md border">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-accent/50"
              onClick={() => setEditorOpen((v) => !v)}
              aria-expanded={editorOpen}
              data-testid={`log-edit-prescription-${entry.id}`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Pencil className="h-4 w-4" />
                Edit prescription
              </span>
              <span className="flex items-center gap-2">
                <SaveStatePill
                  state={{ isSaving: planSets.isSaving, lastSavedAt: planSets.lastSavedAt }}
                  testId={`log-edit-save-state-${entry.id}`}
                />
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    editorOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </span>
            </button>
            {editorOpen ? (
              <div className="space-y-3 border-t p-3">
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
                  title="Coach's prescription"
                  compact
                />
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
                  defaultExpanded
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-2">
          <Button
            type="button"
            className="w-full"
            size="lg"
            onClick={handleLog}
            disabled={isLogging || planSets.isSaving}
            data-testid={`log-as-planned-${entry.id}`}
          >
            <ListChecks className="mr-2 h-4 w-4" />
            {planSets.isSaving
              ? "Saving edits…"
              : isLogging
                ? "Logging…"
                : "Log as planned"}
          </Button>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {onAskCoach ? (
              <Button
                type="button"
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
                type="button"
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
