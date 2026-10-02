import type { ChatFeedback } from "@shared/schema";
import { type RefObject, useCallback } from "react";

import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import type { Message } from "@/lib/chatMessage";
import { humanizeApiError } from "@/lib/queryClient";

import type { SetMessages } from "./chatSessionModel";

/** How long to wait before rating a reply again that the server had not saved yet. */
export const FEEDBACK_RETRY_MS = 1_000;

/** apiRequest throws `${status}: ${body}`. */
function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("404");
}

/**
 * A reply that has just finished arriving can still be on its way into the
 * database (the server saves it as the stream closes), so a 404 is tried once
 * more after a moment.
 */
async function saveFeedback(id: string, feedback: ChatFeedback | null): Promise<void> {
  try {
    await api.chat.setFeedback(id, feedback);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, FEEDBACK_RETRY_MS));
    await api.chat.setFeedback(id, feedback);
  }
}

/**
 * The athlete's thumbs on a coach reply (AI coach chat review, I23): shown at
 * once, saved in the background, and put back with a toast if the save fails.
 * The callback is stable, so passing it to every message keeps their memoized
 * renders through a stream.
 */
export function useMessageFeedback(setMessages: SetMessages, messagesRef: RefObject<Message[]>) {
  const { toast } = useToast();
  return useCallback(
    (id: string, feedback: ChatFeedback | null) => {
      const previous = messagesRef.current.find((message) => message.id === id)?.feedback ?? null;
      const show = (value: ChatFeedback | null) => {
        setMessages((prev) => prev.map((message) => (message.id === id ? { ...message, feedback: value } : message)));
      };
      show(feedback);
      saveFeedback(id, feedback).catch((error: unknown) => {
        show(previous);
        toast({ title: "Couldn't save your rating", description: humanizeApiError(error), variant: "destructive" });
      });
    },
    [messagesRef, setMessages, toast],
  );
}
