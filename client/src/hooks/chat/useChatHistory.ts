import type { ChatMessage as DBChatMessage } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { QUERY_KEYS } from "@/lib/api";
import type { Message } from "@/lib/chatMessage";
import { formatTime } from "@/lib/dateUtils";

import { useClearHistoryMutation, useSaveMessageMutation } from "../useChatMutations";
import { ignoreResult, type SavedTurn, type SetMessages } from "./chatSessionModel";

interface UseChatHistoryOptions {
  welcomeMessage: Message;
  setMessages: SetMessages;
}

/**
 * The saved conversation: loads it once into the chat buffer, saves turns,
 * and clears it.
 */
export function useChatHistory({ welcomeMessage, setMessages }: UseChatHistoryOptions) {
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Chat history is server-of-truth and bounded; useChatMutations.ts already
  // invalidates this key on save/clear. Disable background refetches so we
  // don't redo the fetch on every route change / focus / reconnect (W10).
  const { data: chatHistory = [], isLoading: historyLoading } = useQuery<DBChatMessage[]>({
    queryKey: QUERY_KEYS.chatHistory,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
    if (historyLoading || historyLoaded) return;
    if (chatHistory.length > 0) {
      const loadedMessages: Message[] = chatHistory.map((msg) => ({
        id: msg.id,
        role: msg.role as "user" | "assistant",
        content: msg.content,
        timestamp: msg.timestamp
          ? formatTime(new Date(msg.timestamp))
          : "",
        // Older than anything created in this session, so it sorts first. Not
        // derived from msg.timestamp: that is the server's clock, and a client
        // clock running behind it would sort this session's new turns above
        // the history they follow.
        createdAtMs: 0,
      }));
      setMessages([welcomeMessage, ...loadedMessages]);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- One-time hydration from React Query into the editable chat buffer.
    setHistoryLoaded(true);
  }, [chatHistory, historyLoading, historyLoaded, welcomeMessage, setMessages]);

  const saveMessageMutation = useSaveMessageMutation();
  // Saves never fail the chat turn: a lost save costs that turn on reload, as
  // it always has, not the reply the athlete is reading.
  const saveTurn = useCallback(
    (turn: SavedTurn): Promise<void> => saveMessageMutation.mutateAsync(turn).then(ignoreResult, ignoreResult),
    [saveMessageMutation],
  );

  const clearHistoryMutation = useClearHistoryMutation(() => {
    setMessages([welcomeMessage]);
    setHistoryLoaded(false);
  });

  const clearHistory = useCallback(() => {
    clearHistoryMutation.mutate();
  }, [clearHistoryMutation]);

  return {
    historyLoading,
    saveTurn,
    clearHistory,
    isClearingHistory: clearHistoryMutation.isPending,
  };
}
