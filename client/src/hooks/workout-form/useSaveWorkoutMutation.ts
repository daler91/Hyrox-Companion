import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";

import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import type { SaveWorkoutInput } from "./types";

export function useSaveWorkoutMutation(onSaveSuccess?: () => void) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  return useMutation({
    mutationFn: (workoutData: SaveWorkoutInput) => api.workouts.create(workoutData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workouts }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(() => {});
      // Paired with staleTime: Infinity on analytics queries.
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personalRecords }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exerciseAnalytics }).catch(() => {});
      onSaveSuccess?.();
      toast({
        title: "Workout logged",
        description: "Your workout has been saved successfully.",
      });
      navigate("/");
    },
    onError: (error: unknown) => {
      const code = extractApiErrorCode(error);

      if (code === "STRUCTURED_ROWS_REQUIRED") {
        toast({
          title: "Workout needs structured rows",
          description: "Tap Parse or add at least one exercise set before saving.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Error",
        description: "Failed to save workout. Please try again.",
        variant: "destructive",
      });
    },
  });
}


function extractApiErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;

  const jsonStart = error.message.indexOf("{");
  if (jsonStart < 0) return null;

  try {
    const payload = JSON.parse(error.message.slice(jsonStart)) as { code?: unknown };
    return typeof payload.code === "string" ? payload.code : null;
  } catch {
    return null;
  }
}
