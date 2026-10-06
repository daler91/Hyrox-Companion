import type { GeneratePlanInput, TrainingPlanWithDays } from "@shared/schema";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ignoreResult } from "@/hooks/chat/chatSessionModel";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { QUERY_KEYS } from "@/lib/api/index";
import { AiBudgetExceededError, humanizeApiError, RateLimitError } from "@/lib/queryClient";

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

  // Through humanizeApiError, never the raw message: a new account's first
  // attempt used to toast `403: {"error":…,"code":"AI_COACH_DISABLED"}`
  // verbatim (onboarding audit C1).
  return {
    title: "Failed to generate plan",
    description: humanizeApiError(error),
  };
}

const STATUS_POLL_INTERVAL_MS = 3000;

/**
 * How long one generation is watched. Plans take 1–2 minutes and the longest a
 * few more, but a job stranded by a worker crash never settles (the server
 * fails it only after an hour), and polling had no end: the dialog, which also
 * refused to close, held the athlete until a reload.
 * CL47 (CODEBASE_ANALYSIS_2026-10-03)
 */
export const MAX_GENERATION_WAIT_MS = 20 * 60 * 1000;

/** How long status reads may keep failing before the watch ends (CL47). */
export const MAX_STATUS_OUTAGE_MS = 30 * 1000;

export type GenerationPollOutcome = "waiting" | "ready" | "failed" | "timed_out" | "unreachable";

export interface GenerationPoll {
  /** The last status the server reported. */
  readonly generationStatus: string | undefined;
  /** Whether the latest status read failed, after its retry. */
  readonly isError: boolean;
  readonly dataUpdatedAt: number;
  readonly errorUpdatedAt: number;
  /** When the server accepted the generation. */
  readonly startedAt: number;
}

/**
 * Where a watched generation stands: settled by the server, or given up on
 * once status reads have failed for MAX_STATUS_OUTAGE_MS since the last good
 * one, or have gone on past MAX_GENERATION_WAIT_MS. It reads only the status
 * query's own timestamps, so it stays pure.
 */
export function generationPollOutcome(poll: GenerationPoll): GenerationPollOutcome {
  if (poll.generationStatus === "ready") return "ready";
  if (poll.generationStatus === "failed") return "failed";
  const lastGoodReadAt = Math.max(poll.dataUpdatedAt, poll.startedAt);
  if (poll.isError && poll.errorUpdatedAt - lastGoodReadAt >= MAX_STATUS_OUTAGE_MS) {
    return "unreachable";
  }
  const lastReadAt = Math.max(poll.dataUpdatedAt, poll.errorUpdatedAt);
  return lastReadAt - poll.startedAt >= MAX_GENERATION_WAIT_MS ? "timed_out" : "waiting";
}

/** The status query's reads, as a poll of the generation begun at `startedAt`. */
function pollOf(
  reads: {
    readonly data: { readonly generationStatus: string } | undefined;
    readonly status: string;
    readonly dataUpdatedAt: number;
    readonly errorUpdatedAt: number;
  },
  startedAt: number,
): GenerationPoll {
  return {
    generationStatus: reads.data?.generationStatus,
    isError: reads.status === "error",
    dataUpdatedAt: reads.dataUpdatedAt,
    errorUpdatedAt: reads.errorUpdatedAt,
    startedAt,
  };
}

/** The toast for a watch that ended without a plan to show. */
function generationEndedToast(
  outcome: "failed" | "timed_out" | "unreachable",
  serverError: string | undefined,
) {
  if (outcome === "failed") {
    const toastContent = getGeneratePlanErrorToast(
      new Error(serverError ?? "Plan generation failed"),
    );
    return { variant: "destructive" as const, ...toastContent };
  }
  if (outcome === "timed_out") {
    return {
      title: "Your plan is taking longer than usual",
      description:
        "We've stopped waiting for it here. If it finishes, it will appear in your plans. Otherwise, try again in a few minutes.",
    };
  }
  return {
    variant: "destructive" as const,
    title: "Couldn't check on your plan",
    description:
      "We lost touch with the server while your plan was generating. It may still appear in your plans; if not, try again in a few minutes.",
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
  // The generation being watched, and when the server accepted it.
  const [pending, setPending] = useState<{ planId: string; startedAt: number } | null>(null);
  const pendingPlanId = pending?.planId ?? null;
  const startedAt = pending?.startedAt ?? 0;
  const [successCallback, setSuccessCallback] = useState<((plan: TrainingPlanWithDays) => void) | null>(null);

  const statusQuery = useQuery({
    queryKey: ["plan-generation-status", pendingPlanId],
    queryFn: pendingPlanId ? () => api.plans.getGenerationStatus(pendingPlanId) : skipToken,
    // Polls until the server settles the plan or the watch is given up on (CL47).
    refetchInterval: (query) =>
      generationPollOutcome(pollOf(query.state, startedAt)) === "waiting"
        ? STATUS_POLL_INTERVAL_MS
        : false,
  });

  const mutation = useMutation({
    mutationFn: (input: GeneratePlanInput) => api.plans.generate(input),
    onSuccess: (stub) => {
      setPending({ planId: stub.id, startedAt: Date.now() });
      // The route has put the injuries box on the athlete card and may have
      // dropped the older note the box was prefilled with, so the next wizard
      // and Settings show the card as it is now.
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.athleteFacts }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }),
      ]);
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

  const stopWatching = () => {
    setPending(null);
    setSuccessCallback(null);
  };

  const finishReadyPlan = async (planId: string) => {
    try {
      const fullPlan = await api.plans.get(planId);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.plans });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline });
      toast({ title: "Training plan generated successfully!" });
      successCallback?.(fullPlan);
    } catch {
      toast({ title: "Plan ready, but failed to load it.", variant: "destructive" });
    } finally {
      stopWatching();
    }
  };

  const outcome = generationPollOutcome(pollOf(statusQuery, startedAt));

  useEffect(() => {
    if (!pendingPlanId || outcome === "waiting") return;
    if (outcome === "ready") {
      finishReadyPlan(pendingPlanId).catch(ignoreResult);
      return;
    }
    // Failed, or given up on (CL47): polling has stopped, so say so.
    toast(generationEndedToast(outcome, statusQuery.data?.error));
    // Only react when the outcome changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);

  // In flight while the plan is on its way, or ready and still loading. A
  // watch that failed or was given up on is over (CL47), though it is kept
  // until the next generation or a reset, so a late answer (a refetch on
  // reconnect) can still deliver the plan.
  const isPending =
    mutation.isPending ||
    (pendingPlanId !== null && (outcome === "waiting" || outcome === "ready"));

  const mutate = (input: GeneratePlanInput, callbacks?: { onSuccess?: (plan: TrainingPlanWithDays) => void }) => {
    // W13: ignore re-submits while a generation is already in flight, so a
    // double-click can't start a second job before isPending propagates to the
    // button (the server also rejects this with 409 as the authoritative guard).
    if (isPending) return;
    // Set every time, so an earlier generation's callback never fires for this one.
    const onSuccess = callbacks?.onSuccess ?? null;
    setSuccessCallback(() => onSuccess);
    mutation.mutate(input);
  };

  const reset = () => {
    stopWatching();
    mutation.reset();
  };

  return { mutate, isPending, reset };
}
