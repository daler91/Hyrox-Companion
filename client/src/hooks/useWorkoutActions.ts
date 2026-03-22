import { type ParsedExercise, type TimelineEntry, type PlanDay, type WorkoutStatus, type UpdateWorkoutLog, type User } from "@shared/schema";
import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { createWorkout, updateWorkout, deleteWorkout, updateDayStatus, updateDayDetails, deleteDay } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

export function useWorkoutActions(selectedPlanId: string | null) {
  const { toast } = useToast();
  const [detailEntry, setDetailEntry] = useState<TimelineEntry | null>(null);
  const [skipConfirmEntry, setSkipConfirmEntry] = useState<TimelineEntry | null>(null);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ dayId, status }: { dayId: string; status: string }) => {
      return await updateDayStatus(dayId, status);
    },
    onSuccess: (data, variables) => {
      if (variables.status === "completed") {
        queryClient.setQueryData<User | null>(["/api/v1/auth/user"], (old) => {
          if (!old) return old;
          return { ...old, isAutoCoaching: true };
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/v1/timeline"] });
      toast({ title: "Status updated" });
    },
    onError: () => {
      toast({ title: "Failed to update status", variant: "destructive" });
    },
  });

  const updateDayMutation = useMutation({
    mutationFn: async ({ dayId, updates }: { dayId: string; updates: Partial<PlanDay> }) => {
      return await updateDayDetails(selectedPlanId, dayId, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/timeline"] });
      setDetailEntry(null);
      toast({ title: "Entry updated" });
    },
    onError: () => {
      toast({ title: "Failed to update entry", variant: "destructive" });
    },
  });

  const logWorkoutMutation = useMutation({
    mutationFn: async (data: { planDayId: string; date: string; focus: string; mainWorkout: string; accessory?: string; notes?: string; rpe?: number; exercises?: ParsedExercise[] }) => {
      return await createWorkout(data);
    },
    onSuccess: () => {
      queryClient.setQueryData<User | null>(["/api/v1/auth/user"], (old) => {
        if (!old) return old;
        return { ...old, isAutoCoaching: true };
      });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/timeline"] });
      setDetailEntry(null);
      toast({ title: "Workout logged!" });
    },
    onError: () => {
      toast({ title: "Failed to log workout", variant: "destructive" });
    },
  });

  const updateWorkoutMutation = useMutation({
    mutationFn: async ({ workoutId, updates }: { workoutId: string; updates: UpdateWorkoutLog & { exercises?: ParsedExercise[] } }) => {
      return await updateWorkout(workoutId, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/workouts"] });
      setDetailEntry(null);
      toast({ title: "Workout updated" });
    },
    onError: () => {
      toast({ title: "Failed to update workout", variant: "destructive" });
    },
  });

  const deleteWorkoutMutation = useMutation({
    mutationFn: async (workoutId: string) => {
      return await deleteWorkout(workoutId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/workouts"] });
      setDetailEntry(null);
      toast({ title: "Workout deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete workout", variant: "destructive" });
    },
  });

  const deletePlanDayMutation = useMutation({
    mutationFn: async (dayId: string) => {
      return await deleteDay(dayId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/plans"] });
      setDetailEntry(null);
      toast({ title: "Workout removed from plan" });
    },
    onError: () => {
      toast({ title: "Failed to delete workout", variant: "destructive" });
    },
  });

  const openDetailDialog = useCallback((entry: TimelineEntry) => {
    setDetailEntry(entry);
  }, []);

  const handleSaveFromDetail = useCallback((updates: { focus: string; mainWorkout: string; accessory: string | null; notes: string | null; rpe?: number | null; exercises?: ParsedExercise[] }) => {
    if (!detailEntry) return;

    if (detailEntry.workoutLogId) {
      updateWorkoutMutation.mutate({
        workoutId: detailEntry.workoutLogId,
        updates: { ...updates, exercises: updates.exercises },
      });
      return;
    }

    if (!detailEntry.planDayId) return;

    if (updates.exercises && updates.exercises.length > 0) {
      logWorkoutMutation.mutate({
        planDayId: detailEntry.planDayId,
        date: detailEntry.date,
        focus: updates.focus,
        mainWorkout: updates.mainWorkout,
        accessory: updates.accessory || undefined,
        notes: updates.notes || undefined,
        rpe: updates.rpe ?? undefined,
        exercises: updates.exercises,
      });
      return;
    }

    updateDayMutation.mutate({
      dayId: detailEntry.planDayId,
      updates,
    });
  }, [detailEntry, updateWorkoutMutation, logWorkoutMutation, updateDayMutation]);

  const handleMarkComplete = useCallback((entry: TimelineEntry) => {
    if (!entry.planDayId) return;
    logWorkoutMutation.mutate({
      planDayId: entry.planDayId,
      date: entry.date,
      focus: entry.focus,
      mainWorkout: entry.mainWorkout,
      accessory: entry.accessory || undefined,
      notes: entry.notes || undefined,
    });
  }, [logWorkoutMutation]);

  const handleSkip = useCallback((entry: TimelineEntry) => {
    setSkipConfirmEntry(entry);
  }, []);

  const confirmSkip = useCallback(() => {
    if (!skipConfirmEntry?.planDayId) return;
    updateStatusMutation.mutate({ dayId: skipConfirmEntry.planDayId, status: "skipped" });
    setSkipConfirmEntry(null);
  }, [skipConfirmEntry, updateStatusMutation]);

  const handleChangeStatus = useCallback((entry: TimelineEntry, status: WorkoutStatus) => {
    if (!entry.planDayId) return;
    updateStatusMutation.mutate({ dayId: entry.planDayId, status });
  }, [updateStatusMutation]);

  const handleDelete = useCallback((entry: TimelineEntry) => {
    if (entry.workoutLogId && !entry.planDayId) {
      deleteWorkoutMutation.mutate(entry.workoutLogId);
    } else if (entry.planDayId) {
      deletePlanDayMutation.mutate(entry.planDayId);
    }
  }, [deleteWorkoutMutation, deletePlanDayMutation]);

  return {
    detailEntry,
    setDetailEntry,
    skipConfirmEntry,
    setSkipConfirmEntry,
    openDetailDialog,
    handleSaveFromDetail,
    handleMarkComplete,
    handleSkip,
    confirmSkip,
    handleChangeStatus,
    handleDelete,
    updateStatusMutation,
    updateDayMutation,
    logWorkoutMutation,
    updateWorkoutMutation,
    deleteWorkoutMutation,
    deletePlanDayMutation,
  };
}
