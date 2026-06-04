import type { GeneratePlanInput, TrainingPlanWithDays } from "@shared/schema";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { QUERY_KEYS } from "@/lib/api/index";
import { AiBudgetExceededError, RateLimitError } from "@/lib/queryClient";

export function getGeneratePlanErrorToast(error: Error) {
  const message = error.message.toLowerCase();
  const isAiUnavailable =
    message.includes("ai_unavailable") ||
    message.includes("ai service temporarily unavailable") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("plan generation failed");

  if (isAiUnavailable) {
    return {
      title: "AI plan generation failed",
      description: "The AI service was temporarily unavailable. Please try again in a moment.",
    };
  }

  return {
    title: "Failed to generate plan",
    description: error.message,
  };
}

export interface UseGeneratePlanResult {
  mutate: (input: GeneratePlanInput, callbacks?: { onSuccess?: (plan: TrainingPlanWithDays) => void }) => void;
  isPending: boolean;
  reset: () => void;
}

export function useGeneratePlan(): UseGeneratePlanResult {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [successCallback, setSuccessCallback] = useState<((plan: TrainingPlanWithDays) => void) | null>(null);

  const statusQuery = useQuery({
    queryKey: ["plan-generation-status", pendingPlanId],
    queryFn: pendingPlanId ? () => api.plans.getGenerationStatus(pendingPlanId) : skipToken,
    refetchInterval: (query) => {
      const s = query.state.data?.generationStatus;
      return s === "ready" || s === "failed" ? false : 3000;
    },
  });

  const mutation = useMutation({
    mutationFn: (input: GeneratePlanInput) => api.plans.generate(input),
    onSuccess: (stub) => {
      setPendingPlanId(stub.id);
    },
    onError: (error: Error) => {
      if (error instanceof AiBudgetExceededError) {
        toast({
          title: "Daily AI limit reached",
          description: "You've used your daily AI allowance. It resets on a rolling 24-hour basis.",
          variant: "destructive",
        });
      } else if (error instanceof RateLimitError) {
        const waitMsg = error.retryAfter
          ? `Please wait ${error.retryAfter} seconds before trying again.`
          : "Please wait a moment before trying again.";
        toast({ title: "Too many requests", description: waitMsg, variant: "destructive" });
      } else {
        const toastContent = getGeneratePlanErrorToast(error);
        toast({ variant: "destructive", ...toastContent });
      }
    },
  });

  const generationStatus = statusQuery.data?.generationStatus;

  useEffect(() => {
    if (!pendingPlanId) return;

    if (generationStatus === "ready") {
      void (async () => {
        try {
          const fullPlan = await api.plans.get(pendingPlanId);
          await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.plans });
          await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline });
          toast({ title: "Training plan generated successfully!" });
          successCallback?.(fullPlan);
        } catch {
          toast({ title: "Plan ready, but failed to load it.", variant: "destructive" });
        } finally {
          setPendingPlanId(null);
          setSuccessCallback(null);
        }
      })();
    }

    if (generationStatus === "failed") {
      void (async () => {
        const errMsg = statusQuery.data?.error ?? "Plan generation failed";
        const toastContent = getGeneratePlanErrorToast(new Error(errMsg));
        toast({ variant: "destructive", ...toastContent });
        setPendingPlanId(null);
        setSuccessCallback(null);
      })();
    }
  // Only react when generationStatus changes, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generationStatus]);

  const isPending = mutation.isPending || pendingPlanId !== null;

  const mutate = (input: GeneratePlanInput, callbacks?: { onSuccess?: (plan: TrainingPlanWithDays) => void }) => {
    // W13: ignore re-submits while a generation is already in flight, so a
    // double-click can't start a second job before isPending propagates to the
    // button (the server also rejects this with 409 as the authoritative guard).
    if (isPending) return;
    if (callbacks?.onSuccess) {
      setSuccessCallback(() => callbacks.onSuccess!);
    }
    mutation.mutate(input);
  };

  const reset = () => {
    setPendingPlanId(null);
    setSuccessCallback(null);
    mutation.reset();
  };

  return { mutate, isPending, reset };
}
