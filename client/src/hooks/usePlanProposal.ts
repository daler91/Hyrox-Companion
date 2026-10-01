import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import type { Message } from "@/hooks/useChatSession";
import { api, type PlanProposalView, QUERY_KEYS, type UndoPlanProposalResponse } from "@/lib/api";
import { createLocalMessage } from "@/lib/chatMessage";
import { AiBudgetExceededError, queryClient, RateLimitError } from "@/lib/queryClient";

import { ignoreResult } from "./chat/chatSessionModel";

interface UsePlanProposalOptions {
  /** Push a local assistant message into the chat log (optional — the
   * embedded workout chat omits it and relies on the card disappearing). */
  addLocalMessage?: (message: Message) => void;
  /** Persist a confirmation message to chat history. */
  saveMessage?: (msg: { role: string; content: string }) => void;
}

/** The changes an apply wrote: the athlete's pick, or all of them. */
function appliedChanges(proposal: PlanProposalView, planDayIds?: readonly string[]) {
  const ids = planDayIds ?? proposal.appliedPlanDayIds;
  if (!ids) return proposal.changes;
  const picked = new Set(ids);
  return proposal.changes.filter((change) => picked.has(change.planDayId));
}

function invalidatePlanQueries(changes: PlanProposalView["changes"]): void {
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.plans }).catch(() => {});
  let structuredChanged = false;
  let prescriptionChanged = false;
  for (const change of changes) {
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

/** The proposal's card in the chat re-reads its status: applied, dismissed, or gone stale. */
function invalidateProposal(id: string): void {
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.planProposal(id) }).catch(ignoreResult);
}

/**
 * A proposal's current status, for its card at the chat turn that produced
 * it. Starts from the copy the chat message carried and re-reads only when
 * an apply, a dismiss or a newer proposal invalidates it.
 */
export function useLiveProposal(snapshot: PlanProposalView): PlanProposalView {
  const { data } = useQuery({
    queryKey: QUERY_KEYS.planProposal(snapshot.id),
    queryFn: async () => (await api.planProposals.get(snapshot.id)).proposal,
    initialData: snapshot,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return data;
}

/** The server's own explanation, from a conflict whose body is parseable JSON. */
function conflictMessage(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.message.startsWith("409")) return undefined;
  const jsonStart = error.message.indexOf("{");
  if (jsonStart === -1) return undefined;
  try {
    const body = JSON.parse(error.message.slice(jsonStart)) as { message?: string };
    return body.message || undefined;
  } catch {
    return undefined;
  }
}

function humanizeApplyError(error: unknown): string {
  if (error instanceof AiBudgetExceededError) {
    return "You've reached your daily AI usage limit, so I couldn't apply the changes. Please try again later.";
  }
  if (error instanceof RateLimitError) {
    return "You're sending requests too quickly. Please wait a moment and try again.";
  }
  if (error instanceof Error && error.message.startsWith("409")) {
    // Conflict — the proposal went stale or was resolved elsewhere.
    return (
      conflictMessage(error) ??
      "Your plan changed since I proposed this, so I didn't apply anything. Ask me again and I'll work from the latest plan."
    );
  }
  return "I couldn't apply those changes right now. Please try again.";
}

function humanizeUndoError(error: unknown): string {
  if (error instanceof RateLimitError) {
    return "You're sending requests too quickly. Please wait a moment and try again.";
  }
  return conflictMessage(error) ?? "I couldn't undo those changes right now. Please try again.";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function appliedMessage(count: number, total: number): string {
  if (count < total) return `Done — I've applied ${count} of the ${total} changes to your plan.`;
  return `Done — I've updated ${plural(count, "day")} in your plan.`;
}

function undoneMessage(result: UndoPlanProposalResponse): string {
  const restored = `Undone — I've put ${plural(result.restoredCount ?? 0, "day")} back the way they were.`;
  const kept = (result.keptDays ?? []).map((day) => day.dayLabel).filter(Boolean);
  return kept.length > 0 ? `${restored} I left what's changed since on ${kept.join(", ")} as it is.` : restored;
}

interface ApplyRequest {
  readonly proposal: PlanProposalView;
  /** The changes to apply, by plan day; all of them when absent. */
  readonly planDayIds?: readonly string[];
}

/**
 * Pending plan-adjustment proposal state + apply/dismiss/undo actions.
 * Query-driven (like the suggestions cards) so a pending proposal
 * automatically reappears after a reload. Its card sits at the chat turn
 * that produced it when that turn is in view (useLiveProposal), and at the
 * end of the chat otherwise — where the proposal this surface just applied
 * stays too, so its Undo is in reach.
 */
export function usePlanProposal(options: UsePlanProposalOptions = {}) {
  const { addLocalMessage, saveMessage } = options;
  const [justApplied, setJustApplied] = useState<PlanProposalView | null>(null);

  const { data } = useQuery({
    queryKey: QUERY_KEYS.planProposalPending,
    queryFn: () => api.planProposals.getPending(),
    staleTime: 30_000,
  });
  const pending = data?.proposal ?? null;

  const pushAssistantMessage = useCallback(
    (content: string, persist: boolean) => {
      addLocalMessage?.(createLocalMessage("assistant", content));
      if (persist) saveMessage?.({ role: "assistant", content });
    },
    [addLocalMessage, saveMessage],
  );

  const applyMutation = useMutation({
    mutationFn: ({ proposal, planDayIds }: ApplyRequest) => api.planProposals.apply(proposal.id, planDayIds),
    onSuccess: (result, { proposal, planDayIds }) => {
      invalidatePendingProposal();
      if (result.applied) {
        const changes = appliedChanges(proposal, planDayIds);
        invalidatePlanQueries(changes);
        setJustApplied(proposal);
        pushAssistantMessage(appliedMessage(result.changeCount ?? changes.length, proposal.changes.length), true);
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
    onSettled: (_result, _error, { proposal }) => {
      invalidateProposal(proposal.id);
    },
  });

  const undoMutation = useMutation({
    mutationFn: (toUndo: PlanProposalView) => api.planProposals.undo(toUndo.id),
    onSuccess: (result, toUndo) => {
      invalidatePlanQueries(appliedChanges(toUndo));
      pushAssistantMessage(undoneMessage(result), true);
    },
    onError: (error: unknown) => {
      pushAssistantMessage(humanizeUndoError(error), false);
    },
    onSettled: (_result, _error, toUndo) => {
      invalidateProposal(toUndo.id);
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.planProposals.dismiss(id),
    onSettled: (_result, _error, id) => {
      invalidatePendingProposal();
      invalidateProposal(id);
    },
  });

  const applyProposal = useCallback(
    (toApply: PlanProposalView, planDayIds?: readonly string[]) => {
      if (applyMutation.isPending) return;
      applyMutation.mutate({ proposal: toApply, planDayIds });
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

  const undoProposal = useCallback(
    (toUndo: PlanProposalView) => {
      if (undoMutation.isPending) return;
      undoMutation.mutate(toUndo);
    },
    [undoMutation],
  );

  return {
    /** The pending proposal, or else the one this surface applied last: the card that trails the chat. */
    proposal: pending ?? justApplied,
    isApplyingProposal: applyMutation.isPending,
    /** The proposal an undo is in flight for. */
    undoingProposalId: undoMutation.isPending ? (undoMutation.variables?.id ?? null) : null,
    applyProposal,
    dismissProposal,
    undoProposal,
  };
}
