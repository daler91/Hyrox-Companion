import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { api, type ChatFocus, type ChatHistoryMessage, QUERY_KEYS } from "@/lib/api";
import type { Message } from "@/lib/chatMessage";

import { useClearHistoryMutation } from "../useChatMutations";
import { messageFromHistory, type SetMessages } from "./chatSessionModel";
import { recordOlderHistoryCursor } from "./useOlderChatHistory";

interface UseChatHistoryOptions {
  welcomeMessage: Message;
  setMessages: SetMessages;
  /** The workout whose own thread this chat shows; the general conversation without one (I4). */
  focus?: ChatFocus;
}

/**
 * The buffer once the saved conversation arrives: the welcome, the saved rows,
 * then whatever this surface sent while they loaded. Replacing the buffer
 * dropped a message sent before the history arrived, with the reply streaming
 * into it; both turns reappeared only on the next mount. The server saves a
 * send's turns under the ids it carried, so a row the history already holds
 * is shown once, as the copy here, which carries the live reply and any failure.
 * CL41 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function withSavedHistory(
  current: Message[],
  welcomeMessage: Message,
  history: ChatHistoryMessage[],
): Message[] {
  const sentHere = current.filter((message) => message.id !== welcomeMessage.id);
  const shownHere = new Set(sentHere.map((message) => message.id));
  const saved = history.filter((row) => !shownHere.has(row.id)).map(messageFromHistory);
  return [welcomeMessage, ...saved, ...sentHere];
}

/**
 * The saved conversation: loads it once into the chat buffer, and clears it.
 * The server saves the turns (chat/chatStream.ts refreshes this query after
 * each send, for the next surface that mounts).
 */
export function useChatHistory({ welcomeMessage, setMessages, focus = {} }: UseChatHistoryOptions) {
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const { focusPlanDayId, focusWorkoutLogId } = focus;
  const inThread = Boolean(focusPlanDayId || focusWorkoutLogId);

  // Chat history is server-of-truth and bounded; sends and clears invalidate
  // this key. Disable background refetches so we don't redo the fetch on
  // every route change / focus / reconnect (W10).
  const { data: chatHistory = [], isLoading: historyLoading } = useQuery<ChatHistoryMessage[]>({
    queryKey: inThread ? QUERY_KEYS.chatThreadHistory(focusPlanDayId, focusWorkoutLogId) : QUERY_KEYS.chatHistory,
    // Keeps the cursor to the page before this one (CL56, useOlderChatHistory).
    queryFn: ({ client }) =>
      api.chat.getHistory(
        { focusPlanDayId, focusWorkoutLogId },
        recordOlderHistoryCursor(client, { focusPlanDayId, focusWorkoutLogId }),
      ),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
    if (historyLoading || historyLoaded) return;
    if (chatHistory.length > 0) {
      setMessages((current) => withSavedHistory(current, welcomeMessage, chatHistory));
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
