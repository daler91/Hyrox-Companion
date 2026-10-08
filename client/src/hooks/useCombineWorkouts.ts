import type { TimelineEntry } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { useCallback,useState } from "react";

import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { EXERCISE_HISTORY_QUERY_PREFIX } from "@/lib/workoutInvalidation";

export function useCombineWorkouts() {
  const { toast } = useToast();
  const [combiningEntry, setCombiningEntry] = useState<TimelineEntry | null>(null);
  const [combineSecondEntry, setCombineSecondEntry] = useState<TimelineEntry | null>(null);
  const [showCombineDialog, setShowCombineDialog] = useState(false);

  const combineWorkoutsMutation = useMutation({
    mutationFn: async ({ newWorkout, entriesToDelete }: { newWorkout: { date: string; focus: string; mainWorkout: string; duration?: number; calories?: number; notes?: string }; entriesToDelete: TimelineEntry[] }) => {
      const deleteWorkoutIds = entriesToDelete
        .map((e) => e.workoutLogId)
        .filter((id): id is string => !!id);
      // A logged session that completed a plan day hands that day to the
      // merged workout, so merging it with a duplicate import keeps the day
      // completed instead of turning it into a skip. A3 (CODEBASE_ANALYSIS_2026-10-03)
      const keptPlanDayId = entriesToDelete.find((e) => e.workoutLogId && e.planDayId)?.planDayId ?? null;
      const skipPlanDayIds = entriesToDelete
        .map((e) => e.planDayId)
        .filter((id): id is string => !!id && id !== keptPlanDayId);

      return api.workouts.combine({
        newWorkout: keptPlanDayId ? { ...newWorkout, planDayId: keptPlanDayId } : newWorkout,
        deleteWorkoutIds,
        skipPlanDayIds: skipPlanDayIds.length > 0 ? skipPlanDayIds : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workouts }).catch(() => {});
      // Combining re-parents both sources' exercise sets onto the merged
      // workout (server/services/combineWorkouts.ts), so the PRs and analytics
      // derived from those sets must refresh.
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personalRecords }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exerciseAnalytics }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }).catch(() => {});
      // The "Last time" history still names the sources' ids, so the merged
      // workout's own sheet would quote its sets back as the last session.
      // CL43 (CODEBASE_ANALYSIS_2026-10-03)
      queryClient
        .invalidateQueries({ queryKey: EXERCISE_HISTORY_QUERY_PREFIX })
        .catch(() => undefined);
      // Device-imported sources go to the recycle bin before they are deleted.
      // CL50 (CODEBASE_ANALYSIS_2026-10-03)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.recycleBin }).catch(() => undefined);
      setCombiningEntry(null);
      setCombineSecondEntry(null);
      setShowCombineDialog(false);
      toast({ title: "Workouts combined!" });
    },
    onError: () => {
      setCombiningEntry(null);
      setCombineSecondEntry(null);
      setShowCombineDialog(false);
      toast({ title: "Failed to combine workouts", variant: "destructive" });
    },
  });

  // Combine mode starts from a logged workout's review sheet ("Combine with
  // another workout"); every card tap while it is on comes here. Only logged
  // workouts can be merged: the server deletes the sources by log id.
  // A3 (CODEBASE_ANALYSIS_2026-10-03)
  const handleCombine = useCallback((entry: TimelineEntry) => {
    if (!combiningEntry) {
      if (!entry.workoutLogId) {
        toast({ title: "Only logged workouts can be combined", variant: "destructive" });
        return;
      }
      setCombiningEntry(entry);
      toast({
        title: "Select another workout to combine with",
        description: "Tap another logged workout on the same day, or tap this one again to cancel.",
      });
      return;
    }
    if (combiningEntry.id === entry.id) {
      setCombiningEntry(null);
      toast({ title: "Combine cancelled" });
    } else if (combiningEntry.date !== entry.date) {
      toast({ title: "Can only combine workouts on the same day", variant: "destructive" });
      setCombiningEntry(null);
    } else if (entry.workoutLogId) {
      setCombineSecondEntry(entry);
      setShowCombineDialog(true);
    } else {
      toast({
        title: "Only logged workouts can be combined",
        description: "Pick a completed workout, or tap the first one again to cancel.",
      });
    }
  }, [combiningEntry, toast]);

  const handleConfirmCombine = useCallback((combinedWorkout: {
    date: string;
    focus: string;
    mainWorkout: string;
    duration?: number;
    calories?: number;
    notes?: string;
  }) => {
    if (combiningEntry && combineSecondEntry) {
      combineWorkoutsMutation.mutate({
        newWorkout: combinedWorkout,
        entriesToDelete: [combiningEntry, combineSecondEntry],
      });
    }
  }, [combiningEntry, combineSecondEntry, combineWorkoutsMutation]);

  return {
    combiningEntry,
    setCombiningEntry,
    combineSecondEntry,
    setCombineSecondEntry,
    showCombineDialog,
    setShowCombineDialog,
    handleCombine,
    handleConfirmCombine,
    combineWorkoutsMutation,
  };
}
