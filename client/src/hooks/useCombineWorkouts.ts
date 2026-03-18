import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { TimelineEntry } from "@shared/schema";

export function useCombineWorkouts() {
  const { toast } = useToast();
  const [combiningEntry, setCombiningEntry] = useState<TimelineEntry | null>(null);
  const [combineSecondEntry, setCombineSecondEntry] = useState<TimelineEntry | null>(null);
  const [showCombineDialog, setShowCombineDialog] = useState(false);

  const combineWorkoutsMutation = useMutation({
    mutationFn: async ({ newWorkout, entriesToDelete }: { newWorkout: { date: string; focus: string; mainWorkout: string; duration?: number; calories?: number; notes?: string }; entriesToDelete: TimelineEntry[] }): Promise<any> => {
      const response = await apiRequest("POST", "/api/v1/workouts", newWorkout);
      const created = await response.json();

      const deletePromises = [];
      for (const entry of entriesToDelete) {
        if (entry.workoutLogId) {
          deletePromises.push(apiRequest("DELETE", `/api/v1/workouts/${entry.workoutLogId}`));
        }
        if (entry.planDayId) {
          deletePromises.push(apiRequest("PATCH", `/api/v1/plans/days/${entry.planDayId}/status`, { status: "skipped" }));
        }
      }
      await Promise.all(deletePromises);

      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/workouts"] });
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
