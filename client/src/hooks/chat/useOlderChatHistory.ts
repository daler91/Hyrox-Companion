import { type QueryClient, skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { api, type ChatFocus, type ChatHistoryCursor, type ChatHistoryMessage } from "@/lib/api";
import type { Message } from "@/lib/chatMessage";

import { messageFromHistory, type SetMessages } from "./chatSessionModel";

/** useChatSession's opening line, which stays first in the buffer. */
const WELCOME_MESSAGE_ID = "welcome";

/**
 * Where a thread's next older page starts, as its newest page reported it.
 * Kept beside that page rather than under QUERY_KEYS.chatHistory: clearing the
 * history writes [] to every query under that key.
 */
function olderCursorKey({ focusPlanDayId, focusWorkoutLogId }: ChatFocus) {
  return [
    "/api/v1/chat/history-cursor",
    { planDayId: focusPlanDayId ?? null, workoutLogId: focusWorkoutLogId ?? null },
  ] as const;
}

/** For useChatHistory's newest-page fetch: keeps the cursor that page carried. */
export function recordOlderHistoryCursor(client: QueryClient, focus: ChatFocus) {
  return (cursor: ChatHistoryCursor | null) => {
    client.setQueryData(olderCursorKey(focus), cursor);
  };
}

/**
 * The buffer with an older page added before the saved messages it holds,
 * leaving out rows already shown (a send since moved the newest page). Saved
 * messages share createdAtMs 0, so their buffer order is the order they show in.
 */
export function withOlderMessages(current: Message[], older: ChatHistoryMessage[]): Message[] {
  const shown = new Set(current.map((message) => message.id));
  const added = older.filter((row) => !shown.has(row.id)).map(messageFromHistory);
  if (added.length === 0) return current;
  const [first, ...rest] = current;
  return first?.id === WELCOME_MESSAGE_ID ? [first, ...added, ...rest] : [...added, ...current];
}

/** The "Load older messages" control a chat surface renders. */
export interface OlderChatMessages {
  readonly hasOlder: boolean;
  readonly isLoading: boolean;
  /** The last load failed; the control offers it again. */
  readonly failed: boolean;
  readonly onLoad: () => void;
}

interface UseOlderChatHistoryOptions {
  setMessages: SetMessages;
  focus: ChatFocus;
  /** The newest page is in the buffer: an older one loaded before it would be overwritten. */
  ready: boolean;
}

/**
 * Coach messages older than the newest page, a page per "Load older
 * messages". The client never read the history's cursor headers, so every
 * message older than the newest 50 rows was out of reach.
 * CL56 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function useOlderChatHistory({
  setMessages,
  focus,
  ready,
}: UseOlderChatHistoryOptions): OlderChatMessages {
  const { focusPlanDayId, focusWorkoutLogId } = focus;
  // Written by useChatHistory's fetch of the newest page; never fetched here.
  const { data: newestPageCursor = null } = useQuery<ChatHistoryCursor | null>({
    queryKey: olderCursorKey({ focusPlanDayId, focusWorkoutLogId }),
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  // Where the next load starts once one has run; null before that.
  const [paged, setPaged] = useState<{ readonly cursor: ChatHistoryCursor | null } | null>(null);
  // A cleared conversation's newest page has no cursor: paging starts over.
  // Adjusted during render, as React advises for state that follows a prop.
  if (newestPageCursor === null && paged !== null) {
    setPaged(null);
  }
  const cursor = paged ? paged.cursor : newestPageCursor;

  const olderPage = useMutation({
    mutationFn: (from: ChatHistoryCursor) =>
      api.chat.getHistoryPage({ focusPlanDayId, focusWorkoutLogId }, from),
    onSuccess: (page) => {
      setMessages((current) => withOlderMessages(current, page.messages));
      setPaged({ cursor: page.nextCursor });
    },
  });
  const { isPending, isError, mutate } = olderPage;

  const hasOlder = ready && cursor !== null;
  const onLoad = useCallback(() => {
    if (hasOlder && cursor && !isPending) mutate(cursor);
  }, [hasOlder, cursor, isPending, mutate]);

  return { hasOlder, isLoading: isPending, failed: isError, onLoad };
}
