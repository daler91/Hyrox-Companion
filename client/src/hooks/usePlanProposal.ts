import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import type { Message } from "@/hooks/useChatSession";
import { api, type PlanProposalView, QUERY_KEYS } from "@/lib/api";
import { getCurrentTimeString } from "@/lib/dateUtils";
import { AiBudgetExceededError, queryClient, RateLimitError } from "@/lib/queryClient";

interface UsePlanProposalOptions {
  /** Push a local assistant message into the chat log (optional — the
   * embedded workout chat omits it and relies on the card disappearing). */
  addLocalMessage?: (message: Message) => void;
  /** Persist a confirmation message to chat history. */
  saveMessage?: (msg: { role: string; content: string }) => void;
}

function invalidatePlanQueries(proposal: PlanProposalView): void {
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.plans }).catch(() => {});
  let structuredChanged = false;
  let prescriptionChanged = false;
  for (const change of proposal.changes) {
    if (change.structured) {
      structuredChanged = true;
      queryClient
        .invalidateQueries({ queryKey: QUERY_KEYS.planDayExercises(change.planDayId) })
        .catch(() => {});
    }
    if (change.updatedFields.mainWorkout !== undefined) prescriptionChanged = true;
  }
  if (structuredChanged || prescriptionChanged) {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exerciseAnalytics }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personalRecords }).catch(() => {});
  }
}

function invalidatePendingProposal(): void {
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.planProposalPending }).catch(() => {});
}

function humanizeApplyError(error: unknown): string {
  if (error instanceof AiBudgetExceededError) {
    return "You've reached your daily AI usage limit, so I couldn't apply the changes. Please try again later.";
  }
  if (error instanceof RateLimitError) {
    return "You're sending requests too quickly. Please wait a moment and try again.";
  }
  if (error instanceof Error && error.message.startsWith("409")) {
    // Conflict — the proposal went stale or was resolved elsewhere. Prefer
    // the server's message when the body is parseable JSON.
    const jsonStart = error.message.indexOf("{");
    if (jsonStart !== -1) {
      try {
        const body = JSON.parse(error.message.slice(jsonStart)) as { message?: string };
        if (body.message) return body.message;
      } catch {
        // fall through to the generic conflict copy
      }
    }
    return "Your plan changed since I proposed this, so I didn't apply anything. Ask me again and I'll work from the latest plan.";
  }
  return "I couldn't apply those changes right now. Please try again.";
}

/**
 * Pending plan-adjustment proposal state + apply/dismiss actions.
 * Query-driven (like the suggestions cards) so a pending proposal
 * automatically reappears after a reload.
 */
export function usePlanProposal(options: UsePlanProposalOptions = {}) {
  const { addLocalMessage, saveMessage } = options;

  const { data } = useQuery({
    queryKey: QUERY_KEYS.planProposalPending,
    queryFn: () => api.planProposals.getPending(),
    staleTime: 30_000,
  });
  const proposal = data?.proposal ?? null;

  const pushAssistantMessage = useCallback(
    (content: string, persist: boolean) => {
      addLocalMessage?.({
        id: crypto.randomUUID(),
        role: "assistant",
        content,
        timestamp: getCurrentTimeString(),
      });
      if (persist) saveMessage?.({ role: "assistant", content });
    },
    [addLocalMessage, saveMessage],
  );

  const applyMutation = useMutation({
    mutationFn: (toApply: PlanProposalView) => api.planProposals.apply(toApply.id),
    onSuccess: (result, toApply) => {
      invalidatePendingProposal();
      if (result.applied) {
        invalidatePlanQueries(toApply);
        const count = result.changeCount ?? toApply.changes.length;
        pushAssistantMessage(
          `Done — I've updated ${count} day${count === 1 ? "" : "s"} in your plan.`,
          true,
        );
        return;
      }
      // Retryable failures (structured parse / budget) keep the proposal
      // pending; surface the server's explanation in chat.
      pushAssistantMessage(
        result.message ?? "I couldn't apply those changes. Please try again.",
        false,
      );
    },
    onError: (error: unknown) => {
      invalidatePendingProposal();
      pushAssistantMessage(humanizeApplyError(error), false);
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.planProposals.dismiss(id),
    onSettled: () => {
      invalidatePendingProposal();
    },
  });

  const applyProposal = useCallback(
    (toApply: PlanProposalView) => {
      if (applyMutation.isPending) return;
      applyMutation.mutate(toApply);
    },
    [applyMutation],
  );

  const dismissProposal = useCallback(
    (id: string) => {
      if (dismissMutation.isPending) return;
      dismissMutation.mutate(id);
    },
    [dismissMutation],
  );

  return {
    proposal,
    isApplyingProposal: applyMutation.isPending,
    applyProposal,
    dismissProposal,
  };
}
