import type { PlanDaySkipReason, TimelineEntry, WorkoutStatus } from "@shared/schema";
import { useCallback, useState } from "react";

import { haptic } from "@/lib/haptics";

import { isTimelineEntryBulkDeletable } from "./workout-actions/bulkDelete";
import {
  buildLoggedTimelineEntry,
  useWorkoutActionMutations,
} from "./workout-actions/useWorkoutActionMutations";

interface MarkCompleteOptions {
  readonly onSuccess?: (entry: TimelineEntry) => void;
  /**
   * The log was queued offline rather than saved, so there is no logged
   * entry to open yet. CL55 (CODEBASE_ANALYSIS_2026-10-03)
   */
  readonly onQueued?: () => void;
  readonly onError?: (error: Error) => void;
}


export function useWorkoutActions(selectedPlanId: string | null) {
  const [skipConfirmEntry, setSkipConfirmEntry] = useState<TimelineEntry | null>(null);
  const {
    updateStatusMutation,
    logWorkoutMutation,
    deleteWorkoutMutation,
    deletePlanDayMutation,
    bulkDeleteWorkoutMutation,
  } = useWorkoutActionMutations(selectedPlanId);

  const handleMarkComplete = useCallback(
    (entry: TimelineEntry, options?: MarkCompleteOptions) => {
      if (!entry.planDayId) {
        options?.onError?.(new Error("Cannot complete a workout without a plan day"));
        return;
      }
      // Ticking off a session is the app's one physical-feeling action, so
      // phones that can vibrate get a short tap the moment it registers.
      haptic();
      logWorkoutMutation.mutate({
        planDayId: entry.planDayId,
        date: entry.date,
        focus: entry.focus,
        mainWorkout: entry.mainWorkout,
        accessory: entry.accessory || undefined,
        notes: entry.notes || undefined,
        rpe: entry.rpe ?? undefined,
        sourceEntry: entry,
      }, {
        onSuccess: (result) => {
          if (result.status === "queued") options?.onQueued?.();
          else options?.onSuccess?.(buildLoggedTimelineEntry(result.data, entry));
        },
        onError: (error) => {
          options?.onError?.(error instanceof Error ? error : new Error("Failed to log workout"));
        },
      });
    },
    [logWorkoutMutation],
  );

  const handleSkip = useCallback((entry: TimelineEntry) => {
    setSkipConfirmEntry(entry);
  }, []);

  const confirmSkip = useCallback((reason: PlanDaySkipReason | null = null) => {
    if (!skipConfirmEntry?.planDayId) return;
    updateStatusMutation.mutate({
      dayId: skipConfirmEntry.planDayId,
      status: "skipped",
      // Only send the key when the athlete actually picked one, so an
      // unanswered dialog doesn't overwrite a reason on a re-skip.
      ...(reason ? { skipReason: reason } : {}),
    });
    setSkipConfirmEntry(null);
  }, [skipConfirmEntry, updateStatusMutation]);

  const handleChangeStatus = useCallback(
    (entry: TimelineEntry, status: WorkoutStatus) => {
      if (!entry.planDayId) return;
      updateStatusMutation.mutate({ dayId: entry.planDayId, status });
    },
    [updateStatusMutation],
  );

  const handleDelete = useCallback(
    (entry: TimelineEntry) => {
      // A completed planned session carries both ids, and every surface that
      // calls this asks "Delete workout?". The log is that workout: deleting
      // it lets the server re-sync the plan day back to planned or missed.
      // Preferring the plan day removed only the prescription and left the
      // log behind as an unplanned workout. Only an entry with no log
      // (planned or skipped) deletes its plan day. CL23 (CODEBASE_ANALYSIS_2026-10-03)
      if (entry.workoutLogId) {
        deleteWorkoutMutation.mutate(entry.workoutLogId);
      } else if (entry.planDayId) {
        deletePlanDayMutation.mutate(entry.planDayId);
      }
    },
    [deleteWorkoutMutation, deletePlanDayMutation],
  );

  const handleBulkDelete = useCallback(
    (entries: TimelineEntry[]) => {
      const deletableEntries = entries.filter(isTimelineEntryBulkDeletable);
      if (deletableEntries.length === 0) return;
      bulkDeleteWorkoutMutation.mutate(deletableEntries);
    },
    [bulkDeleteWorkoutMutation],
  );

  return {
    skipConfirmEntry,
    setSkipConfirmEntry,
    handleMarkComplete,
    handleSkip,
    confirmSkip,
    handleChangeStatus,
    handleDelete,
    handleBulkDelete,
    updateStatusMutation,
    logWorkoutMutation,
    deleteWorkoutMutation,
    deletePlanDayMutation,
    bulkDeleteWorkoutMutation,
  };
}
