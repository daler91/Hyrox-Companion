import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";

import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
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

function extractApiErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;

  const asRecord = error as Record<string, unknown>;
  const directCode = asRecord.code;
  if (typeof directCode === "string") return directCode;

  const payloadCode = getCodeFromPayload(asRecord.payload);
  if (payloadCode) return payloadCode;

  const responseDataCode = getCodeFromPayload(
    typeof asRecord.response === "object" ? (asRecord.response as Record<string, unknown> | null)?.data : null,
  );
  if (responseDataCode) return responseDataCode;

  const message = asRecord.message;
  if (typeof message !== "string") return null;

  const jsonStart = message.indexOf("{");
  if (jsonStart < 0) return null;

  try {
    const parsed = JSON.parse(message.slice(jsonStart)) as { code?: unknown };
    return typeof parsed.code === "string" ? parsed.code : null;
  } catch {
    return null;
  }
}

function getCodeFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const code = (payload as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}
