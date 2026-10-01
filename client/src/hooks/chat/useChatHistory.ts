import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { type ChatHistoryMessage, QUERY_KEYS } from "@/lib/api";
import type { Message } from "@/lib/chatMessage";

import { useClearHistoryMutation } from "../useChatMutations";
import { messageFromHistory, type SetMessages } from "./chatSessionModel";

interface UseChatHistoryOptions {
  welcomeMessage: Message;
  setMessages: SetMessages;
}

/**
 * The saved conversation: loads it once into the chat buffer, and clears it.
 * The server saves the turns (chat/chatStream.ts refreshes this query after
 * each send, for the next surface that mounts).
 */
export function useChatHistory({ welcomeMessage, setMessages }: UseChatHistoryOptions) {
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Chat history is server-of-truth and bounded; sends and clears invalidate
  // this key. Disable background refetches so we don't redo the fetch on
  // every route change / focus / reconnect (W10).
  const { data: chatHistory = [], isLoading: historyLoading } = useQuery<ChatHistoryMessage[]>({
    queryKey: QUERY_KEYS.chatHistory,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
    if (historyLoading || historyLoaded) return;
    if (chatHistory.length > 0) {
      setMessages([welcomeMessage, ...chatHistory.map(messageFromHistory)]);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- One-time hydration from React Query into the editable chat buffer.
    setHistoryLoaded(true);
  }, [chatHistory, historyLoading, historyLoaded, welcomeMessage, setMessages]);

  const clearHistoryMutation = useClearHistoryMutation(() => {
    setMessages([welcomeMessage]);
    setHistoryLoaded(false);
  });

  const clearHistory = useCallback(() => {
    clearHistoryMutation.mutate();
  }, [clearHistoryMutation]);

  return {
    historyLoading,
    clearHistory,
    isClearingHistory: clearHistoryMutation.isPending,
  };
}
