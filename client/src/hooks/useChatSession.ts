import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createLocalMessage, type Message } from "@/lib/chatMessage";
import { getCurrentTimeString } from "@/lib/dateUtils";

import { handleSendFailure, ignoreResult, markReplyRateable } from "./chat/chatSessionModel";
import {
  fetchChatReply,
  refreshSavedConversation,
  streamChatReply,
  supportsResponseStreaming,
} from "./chat/chatStream";
import { useBudgetWarning } from "./chat/useBudgetWarning";
import { useChatAutoScroll } from "./chat/useChatAutoScroll";
import { useChatHistory } from "./chat/useChatHistory";
import { useFactProposalDecision } from "./chat/useFactProposalDecision";
import { useMessageFeedback } from "./chat/useMessageFeedback";

export type { RagInfo } from "@/lib/api";
export type { Message } from "@/lib/chatMessage";

interface UseChatSessionOptions {
  welcomeMessage?: string;
  useStreaming?: boolean;
  /** The workout in view when chatting from the workout-detail dialog: its
   * plan day (so "make this day easier" resolves to it) and its log. The
   * server loads both into the coach's FOCUSED WORKOUT context. */
  focusPlanDayId?: string;
  focusWorkoutLogId?: string;
}

interface SendMessageOptions {
  /** A retry: resend under the failed attempt's message id, so the server saves the turn once. */
  userMessageId?: string;
  /** A retry: the failed reply the server drops, if it saved any of it. */
  replaceAssistantId?: string;
}

const DEFAULT_WELCOME = "hey. i'm your ai training coach. ask me about pacing, sessions, or anything you're training for — running, functional fitness, hyrox, the lot.";

/**
 * One coach chat surface: the message buffer and sending into it. The server
 * owns the conversation — it saves both turns under the ids each send carries
 * and reads the history itself. Loading the saved conversation
 * (useChatHistory), keeping the viewport pinned (useChatAutoScroll), the SSE
 * request itself (chat/chatStream.ts) and the pure message and failure rules
 * (chat/chatSessionModel.ts) live beside it.
 */
export function useChatSession(options: UseChatSessionOptions = {}) {
  const {
    welcomeMessage = DEFAULT_WELCOME,
    useStreaming = true,
    focusPlanDayId,
    focusWorkoutLogId,
  } = options;

  const welcomeMessageObj: Message = useMemo(() => ({
    id: "welcome",
    role: "assistant",
    content: welcomeMessage,
    timestamp: getCurrentTimeString(),
    // Use an arbitrary constant (e.g. 0) for the welcome message to preserve purity
    // and guarantee it always sorts first, regardless of when it renders
    createdAtMs: 0,
  }), [welcomeMessage]);

  const [messages, setMessages] = useState<Message[]>([welcomeMessageObj]);
  // A welcome that arrives after mount (the Coach panel fetches one built
  // from the athlete's training) replaces the one already in the buffer.
  // Adjusted during render, as React advises for state that follows a prop.
  const [shownWelcome, setShownWelcome] = useState(welcomeMessageObj);
  if (shownWelcome !== welcomeMessageObj) {
    setShownWelcome(welcomeMessageObj);
    setMessages((prev) => prev.map((message) => (message.id === welcomeMessageObj.id ? welcomeMessageObj : message)));
  }
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  // True while the server is generating a plan-adjustment proposal for the
  // in-flight message ("Reviewing your plan…" instead of "Thinking…").
  const [isReviewingPlan, setIsReviewingPlan] = useState(false);
  // Short, screen-reader-facing announcement for a stream interruption.
  // Surfaced via an assertive live region so abort/network failures are read
  // immediately rather than being buried in the polite conversation log (W8).
  const [streamError, setStreamError] = useState<string | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  const isSubmittingRef = useRef(false);
  const streamControllerRef = useRef<AbortController | null>(null);
  // Monotonic id bumped per send. A flush from a superseded stream (e.g. a
  // requestAnimationFrame flush scheduled just before a disconnect/reconnect)
  // carries a stale id and is ignored, so it can't overwrite the live stream's
  // state (W14).
  const streamGenerationRef = useRef(0);

  const { historyLoading, clearHistory, isClearingHistory } = useChatHistory({
    welcomeMessage: welcomeMessageObj,
    setMessages,
    focus: { focusPlanDayId, focusWorkoutLogId },
  });
  const { scrollRef, scrollToBottom, updateAutoScrollMode, scrollToBottomIfPinned, pinAutoScroll } =
    useChatAutoScroll(messages);
  const warnIfNearBudget = useBudgetWarning();

  useEffect(() => () => {
    // Abort any in-flight stream on unmount so the rAF / setState in
    // consumeSSEStream don't fire against an unmounted tree.
    streamControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const sendMessage = useCallback(async (content: string, sendOptions: SendMessageOptions = {}) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    // Claim this send's stream generation; later flushes check it (W14).
    const generationId = ++streamGenerationRef.current;

    const userMessage = createLocalMessage("user", content, sendOptions.userMessageId);
    setMessages((prev) => [...prev, userMessage]);
    pinAutoScroll();
    setIsLoading(true);
    // Clear any prior interruption announcement so the assertive region only
    // fires on a fresh failure (W8).
    setStreamError(null);

    const assistantMessageId = crypto.randomUUID();
    // The latest streamed text, kept on every flush so the catch below can
    // leave a partial reply in its bubble after a Stop or a dropped connection.
    let fullResponse = "";

    try {
      // The server saves the athlete's turn once it accepts the request — a
      // send it refuses leaves nothing behind — and the reply when it ends,
      // even if this tab has gone by then.
      const request = {
        content,
        focus: { focusPlanDayId, focusWorkoutLogId },
        ids: {
          userMessageId: userMessage.id,
          assistantMessageId,
          replaceAssistantId: sendOptions.replaceAssistantId,
        },
      };

      if (useStreaming && supportsResponseStreaming()) {
        setMessages((prev) => [...prev, createLocalMessage("assistant", "", assistantMessageId)]);

        const controller = new AbortController();
        streamControllerRef.current = controller;
        setIsStreaming(true);

        fullResponse = await streamChatReply({
          ...request,
          signal: controller.signal,
          setMessages,
          isCurrent: () => streamGenerationRef.current === generationId,
          onAccepted: warnIfNearBudget,
          onReviewingPlan: () => setIsReviewingPlan(true),
          onText: (text) => {
            fullResponse = text;
          },
        });
        markReplyRateable(setMessages, assistantMessageId);
      } else {
        const assistantMessage = await fetchChatReply(request);
        // The non-streamed route saves both turns before it answers.
        setMessages((prev) => [...prev, { ...assistantMessage, rateable: true }]);
      }
    } catch (err) {
      handleSendFailure({
        err,
        fullResponse,
        assistantMessageId,
        userMessage,
        setMessages,
        setStreamError,
      });
    } finally {
      refreshSavedConversation();
      streamControllerRef.current = null;
      setIsStreaming(false);
      setIsLoading(false);
      setIsReviewingPlan(false);
      isSubmittingRef.current = false;
    }
  }, [useStreaming, warnIfNearBudget, focusPlanDayId, focusWorkoutLogId, pinAutoScroll]);

  /**
   * Send a failed message again. The failed exchange is dropped first, since
   * the resend adds its own bubbles. It goes under the same message id, so a
   * turn the server already saved isn't saved twice, and names the failed
   * reply, which the server replaces.
   */
  const retryMessage = useCallback((failedMessageId: string) => {
    if (isSubmittingRef.current) return;
    const retry = messagesRef.current.find((m) => m.id === failedMessageId)?.failure?.retry;
    if (!retry) return;
    const isFailedExchange = (m: Message) => m.id === failedMessageId || m.id === retry.userMessageId;
    messagesRef.current = messagesRef.current.filter((m) => !isFailedExchange(m));
    setMessages((prev) => prev.filter((m) => !isFailedExchange(m)));
    // sendMessage reports its own failures on the reply it adds.
    sendMessage(retry.content, {
      userMessageId: retry.userMessageId,
      replaceAssistantId: failedMessageId,
    }).catch(ignoreResult);
  }, [sendMessage]);

  const cancelStream = useCallback(() => {
    streamControllerRef.current?.abort();
  }, []);

  const rateMessage = useMessageFeedback(setMessages, messagesRef);
  const decideFactProposal = useFactProposalDecision(setMessages, messagesRef);

  return {
    messages,
    isLoading,
    isStreaming,
    isReviewingPlan,
    streamError,
    historyLoading,
    scrollRef,
    updateAutoScrollMode,
    scrollToBottomIfPinned,
    pinAutoScroll,
    sendMessage,
    retryMessage,
    rateMessage,
    decideFactProposal,
    cancelStream,
    clearHistory,
    isClearingHistory,
    scrollToBottom,
    hasMessages: messages.length > 1,
  };
}
