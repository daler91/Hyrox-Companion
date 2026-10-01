import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createLocalMessage, type Message } from "@/lib/chatMessage";
import { getCurrentTimeString } from "@/lib/dateUtils";

import { buildHistory, createTurnSaver, handleSendFailure, ignoreResult } from "./chat/chatSessionModel";
import { fetchChatReply, streamChatReply, supportsResponseStreaming } from "./chat/chatStream";
import { useBudgetWarning } from "./chat/useBudgetWarning";
import { useChatAutoScroll } from "./chat/useChatAutoScroll";
import { useChatHistory } from "./chat/useChatHistory";

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
  /** The server accepted, and the client saved, this turn on an earlier attempt. */
  userAlreadySaved?: boolean;
}

const DEFAULT_WELCOME = "hey. i'm your ai training coach. ask me about pacing, sessions, or anything you're training for — running, functional fitness, hyrox, the lot.";

/**
 * One coach chat surface: the message buffer and sending into it. Loading and
 * saving the conversation (useChatHistory), keeping the viewport pinned
 * (useChatAutoScroll), the SSE request itself (chat/chatStream.ts) and the
 * pure history and failure rules (chat/chatSessionModel.ts) live beside it.
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

  const { historyLoading, saveTurn, clearHistory, isClearingHistory } = useChatHistory({
    welcomeMessage: welcomeMessageObj,
    setMessages,
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

    const userMessage = createLocalMessage("user", content);
    setMessages((prev) => [...prev, userMessage]);
    pinAutoScroll();
    setIsLoading(true);
    // Clear any prior interruption announcement so the assertive region only
    // fires on a fresh failure (W8).
    setStreamError(null);

    const assistantMessageId = crypto.randomUUID();
    // The athlete's turn is saved once the server accepts the request, not
    // before: a send it refuses (rate limit, daily cap, AI coaching off) must
    // not leave an unanswered turn in history. Each message's client id is its
    // idempotency key, so a retried save can't persist a turn twice (S7).
    const turns = createTurnSaver(saveTurn, userMessage, assistantMessageId, sendOptions.userAlreadySaved ?? false);
    // The latest streamed text, kept on every flush so the catch below can
    // persist a partial reply after a Stop or a dropped connection.
    let fullResponse = "";

    try {
      const request = {
        content,
        history: buildHistory(messagesRef.current),
        focus: { focusPlanDayId, focusWorkoutLogId },
        assistantMessageId,
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
          onAccepted: (response) => {
            turns.saveUser().catch(ignoreResult);
            warnIfNearBudget(response);
          },
          onReviewingPlan: () => setIsReviewingPlan(true),
          onText: (text) => {
            fullResponse = text;
          },
        });

        if (fullResponse) turns.saveAssistant(fullResponse);
      } else {
        const assistantMessage = await fetchChatReply(request);
        setMessages((prev) => [...prev, assistantMessage]);
        turns.saveAssistant(assistantMessage.content);
      }
    } catch (err) {
      handleSendFailure({
        err,
        fullResponse,
        assistantMessageId,
        userMessage,
        turns,
        setMessages,
        setStreamError,
      });
    } finally {
      streamControllerRef.current = null;
      setIsStreaming(false);
      setIsLoading(false);
      setIsReviewingPlan(false);
      isSubmittingRef.current = false;
    }
  }, [useStreaming, saveTurn, warnIfNearBudget, focusPlanDayId, focusWorkoutLogId, pinAutoScroll]);

  /**
   * Send a failed message again. The failed exchange is dropped first: the
   * resend adds its own bubble, and the history it sends must not carry the
   * attempt that failed. A turn the server already accepted isn't saved twice.
   */
  const retryMessage = useCallback((failedMessageId: string) => {
    if (isSubmittingRef.current) return;
    const retry = messagesRef.current.find((m) => m.id === failedMessageId)?.failure?.retry;
    if (!retry) return;
    const isFailedExchange = (m: Message) => m.id === failedMessageId || m.id === retry.userMessageId;
    // sendMessage reads the history from the ref synchronously, before the
    // state update below has rendered.
    messagesRef.current = messagesRef.current.filter((m) => !isFailedExchange(m));
    setMessages((prev) => prev.filter((m) => !isFailedExchange(m)));
    // sendMessage reports its own failures on the reply it adds.
    sendMessage(retry.content, { userAlreadySaved: retry.userSaved }).catch(ignoreResult);
  }, [sendMessage]);

  const cancelStream = useCallback(() => {
    streamControllerRef.current?.abort();
  }, []);

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
    cancelStream,
    clearHistory,
    isClearingHistory,
    scrollToBottom,
    hasMessages: messages.length > 1,
  };
}
