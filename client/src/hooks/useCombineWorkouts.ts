import type { TimelineEntry } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { useCallback,useState } from "react";

import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

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
      const skipPlanDayIds = entriesToDelete
        .map((e) => e.planDayId)
        .filter((id): id is string => !!id);

      return api.workouts.combine({
        newWorkout,
        deleteWorkoutIds,
        skipPlanDayIds: skipPlanDayIds.length > 0 ? skipPlanDayIds : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workouts }).catch(() => {});
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

  const handleCombine = useCallback((entry: TimelineEntry) => {
    if (combiningEntry) {
      if (combiningEntry.id === entry.id) {
        setCombiningEntry(null);
        toast({ title: "Combine cancelled" });
      } else if (combiningEntry.date === entry.date) {
        setCombineSecondEntry(entry);
        setShowCombineDialog(true);
      } else {
        toast({ title: "Can only combine workouts on the same day", variant: "destructive" });
        setCombiningEntry(null);
      }
    } else {
      setCombiningEntry(entry);
      toast({ title: "Select another workout to combine with", description: "Click on another workout on the same day" });
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
