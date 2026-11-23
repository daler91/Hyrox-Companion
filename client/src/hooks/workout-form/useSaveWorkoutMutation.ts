import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";

import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { extractApiErrorCode } from "@/lib/apiError";
import { runWithOfflineFallback } from "@/lib/offlineMutationFallback";
import { WORKOUT_CREATE_URL } from "@/lib/pendingWorkouts";
import { toastPersonalRecordAchievements } from "@/lib/personalRecordAchievements";
import { invalidateWorkoutWriteQueries } from "@/lib/workoutInvalidation";

import type { SaveWorkoutInput } from "./types";

type SaveWorkoutResult =
  | { status: "saved"; newPersonalRecords: Awaited<ReturnType<typeof api.workouts.create>>["newPersonalRecords"] }
  | { status: "queued"; id: string };

export function useSaveWorkoutMutation(onSaveSuccess?: () => void) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  return useMutation({
    mutationFn: async (workoutData: SaveWorkoutInput): Promise<SaveWorkoutResult> => {
      const result = await runWithOfflineFallback({
        method: "POST",
        url: WORKOUT_CREATE_URL,
        body: workoutData,
        perform: (idempotencyKey) =>
          api.workouts.create(workoutData, createWorkoutOptions(idempotencyKey)),
      });
      return result.status === "queued"
        ? result
        : { status: "saved", newPersonalRecords: result.data.newPersonalRecords };
    },
    onSuccess: (result) => {
      onSaveSuccess?.();
      if (result.status === "queued") {
        toast({
          title: "Workout queued",
          description: "We'll sync it automatically when your connection is back.",
        });
        navigate("/");
        return;
      }

      invalidateWorkoutWriteQueries();
      toast({
        title: "Workout logged",
        description: "Your workout has been saved successfully.",
      });
      toastPersonalRecordAchievements(toast, result.newPersonalRecords);
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

function createWorkoutOptions(idempotencyKey: string | undefined): { idempotencyKey: string } | undefined {
  return idempotencyKey ? { idempotencyKey } : undefined;
}
