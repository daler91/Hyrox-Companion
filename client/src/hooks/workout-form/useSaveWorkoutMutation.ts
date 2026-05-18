import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";

import { useToast } from "@/hooks/use-toast";
import { api, isTimeoutLikeApiError } from "@/lib/api";
import { createOfflineMutationId, enqueueMutation } from "@/lib/offlineQueue";
import { invalidateWorkoutWriteQueries } from "@/lib/workoutInvalidation";

import type { SaveWorkoutInput } from "./types";

const WORKOUT_CREATE_URL = "/api/v1/workouts";

type SaveWorkoutResult =
  | { status: "saved" }
  | { status: "queued"; id: string };

export function useSaveWorkoutMutation(onSaveSuccess?: () => void) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  return useMutation({
    mutationFn: async (workoutData: SaveWorkoutInput): Promise<SaveWorkoutResult> => {
      if (isBrowserOffline()) {
        return queueWorkoutSave(workoutData, createOfflineMutationId());
      }

      const idempotencyKey = createOptionalIdempotencyKey();

      try {
        await api.workouts.create(workoutData, createWorkoutOptions(idempotencyKey));
        return { status: "saved" };
      } catch (error) {
        if (isConnectivityFailure(error)) {
          return queueWorkoutSave(workoutData, idempotencyKey ?? createOfflineMutationId());
        }
        throw error;
      }
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

function queueWorkoutSave(workoutData: SaveWorkoutInput, id: string): SaveWorkoutResult {
  enqueueMutation("POST", WORKOUT_CREATE_URL, workoutData, { id });
  return { status: "queued", id };
}

function createWorkoutOptions(idempotencyKey: string | undefined): { idempotencyKey: string } | undefined {
  return idempotencyKey ? { idempotencyKey } : undefined;
}

function createOptionalIdempotencyKey(): string | undefined {
  try {
    return createOfflineMutationId();
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
}

function isBrowserOffline(): boolean {
  return globalThis.navigator?.onLine === false;
}

function isConnectivityFailure(error: unknown): boolean {
  if (isBrowserOffline() || isTimeoutLikeApiError(error)) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException) {
    return error.name === "AbortError" || error.name === "NetworkError" || error.name === "TimeoutError";
  }
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  if (message.startsWith("failed to fetch csrf token")) return false;
  return (
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("network error") ||
    message.includes("networkerror")
  );
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
