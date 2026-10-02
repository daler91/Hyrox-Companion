import type { ChatFactProposal } from "@shared/schema";
import { type RefObject, useCallback } from "react";

import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import type { Message } from "@/lib/chatMessage";
import { humanizeApiError, queryClient } from "@/lib/queryClient";

import { ignoreResult, type SetMessages } from "./chatSessionModel";
import { FEEDBACK_RETRY_MS } from "./useMessageFeedback";

export type FactProposalDecision = "save" | "dismiss";

/** apiRequest throws `${status}: ${body}`. */
function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("404");
}

/**
 * The offer arrives just before the reply closes, and the server saves the
 * reply as it closes, so a 404 is tried once more after a moment, as a rating is.
 */
async function sendDecision(id: string, decision: FactProposalDecision) {
  try {
    return await api.chat.decideFactProposal(id, decision);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, FEEDBACK_RETRY_MS));
    return await api.chat.decideFactProposal(id, decision);
  }
}

/**
 * The athlete's answer to a fact the coach offered under a reply (AI coach
 * chat review, I5b): shown at once, and put back with a toast if the server
 * refuses it (a full card, most often). Stable, so passing it to every message
 * keeps their memoized renders through a stream.
 */
export function useFactProposalDecision(setMessages: SetMessages, messagesRef: RefObject<Message[]>) {
  const { toast } = useToast();
  return useCallback(
    (id: string, decision: FactProposalDecision) => {
      const previous = messagesRef.current.find((message) => message.id === id)?.factProposal;
      if (previous?.status !== "pending") return;
      const show = (factProposal: ChatFactProposal) =>
        setMessages((prev) => prev.map((message) => (message.id === id ? { ...message, factProposal } : message)));
      show({ ...previous, status: decision === "save" ? "saved" : "dismissed" });
      sendDecision(id, decision)
        .then(() => {
          // A chat surface opened from now on reads the answer, not the offer.
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatHistory }).catch(ignoreResult);
          if (decision !== "save") return;
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.athleteFacts }).catch(ignoreResult);
          toast({ title: "Saved to your athlete card", description: "Your coach will plan around it." });
        })
        .catch((error: unknown) => {
          show(previous);
          toast({
            title: decision === "save" ? "Couldn't save that fact" : "Couldn't update that fact",
            description: humanizeApiError(error),
            variant: "destructive",
          });
        });
    },
    [messagesRef, setMessages, toast],
  );
}
