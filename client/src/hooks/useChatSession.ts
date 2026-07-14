import type { ChatMessage as DBChatMessage } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo,useRef, useState } from "react";

import { api, type PlanProposalView, QUERY_KEYS, type RagInfo } from "@/lib/api";
import { formatTime,getCurrentTimeString } from "@/lib/dateUtils";
import { queryClient } from "@/lib/queryClient";
import { consumeSSEStream } from "@/lib/sseStream";

import { useClearHistoryMutation,useSaveMessageMutation } from "./useChatMutations";

export type { RagInfo } from "@/lib/api";

function createMessageUpdater(
  assistantMessageId: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
) {
  return (snapshot: { content: string; meta?: RagInfo }) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantMessageId
          ? { ...m, content: snapshot.content, ...(snapshot.meta ? { ragInfo: snapshot.meta } : {}) }
          : m,
      ),
    );
  };
}

type StreamErrorKind = "abort" | "network" | "other";

// S9 — the streaming path relies on fetch + Response.body (ReadableStream),
// which is absent on very old WebKit (iOS Safari < 10.3). Feature-detect so
// those clients fall back to the non-streaming /api/v1/chat request instead of
// throwing "No response body".
function supportsResponseStreaming(): boolean {
  return typeof ReadableStream !== "undefined";
}

function classifyStreamError(err: unknown): StreamErrorKind {
  if (err instanceof DOMException && err.name === "AbortError") return "abort";
  // fetch surfaces network failures as TypeError
  if (err instanceof TypeError) return "network";
  return "other";
}

const STREAM_ERROR_SUFFIX: Record<StreamErrorKind, string> = {
  abort: "\n\n(Stopped)",
  network: "\n\n(Connection lost — check your internet)",
  other: "\n\n(Stream interrupted)",
};

const STREAM_ERROR_BODY: Record<StreamErrorKind, string> = {
  abort: "Stopped.",
  network: "Your connection dropped. Check your internet and try again.",
  other: "Something went wrong on our side. Please try again.",
};

interface HandleStreamErrorArgs {
  err: unknown;
  fullResponse: string;
  assistantMessageId: string;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  saveAssistantMessage: (content: string) => void;
  setStreamError: (message: string | null) => void;
}

/**
 * Reconcile chat UI + persistence when the streaming pipeline rejects.
 * Pulled out of `sendMessage` so the latter stays under the cognitive-
 * complexity ceiling — there are three distinct branches (abort with
 * partial, abort without partial, network/other) plus the optimistic-
 * placeholder cleanup, and inlining all of them dwarfed the happy path.
 */
function handleStreamError({
  err,
  fullResponse,
  assistantMessageId,
  setMessages,
  saveAssistantMessage,
  setStreamError,
}: HandleStreamErrorArgs): void {
  const kind = classifyStreamError(err);

  // Announce the interruption assertively (W8). STREAM_ERROR_BODY is already
  // phrased for a human ("Your connection dropped…"), so it doubles as the
  // spoken announcement regardless of whether a partial response survived.
  setStreamError(STREAM_ERROR_BODY[kind]);

  if (fullResponse) {
    const finalContent = fullResponse + STREAM_ERROR_SUFFIX[kind];
    setMessages((prev) =>
      prev.map((m) => (m.id === assistantMessageId ? { ...m, content: finalContent } : m)),
    );
    if (kind === "abort") {
      // Persist the partial so the user doesn't lose it on reload.
      saveAssistantMessage(fullResponse);
    }
    return;
  }

  const errorMessage: Message = {
    id: assistantMessageId,
    role: "assistant",
    content: STREAM_ERROR_BODY[kind],
    timestamp: getCurrentTimeString(),
  };
  setMessages((prev) => {
    const withoutPlaceholder = prev.filter((m) => m.id !== assistantMessageId);
    return [...withoutPlaceholder, errorMessage];
  });
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  ragInfo?: RagInfo;
}

interface UseChatSessionOptions {
  welcomeMessage?: string;
  useStreaming?: boolean;
  /** Plan day in view when chatting from the workout-detail dialog, so
   * "make this day easier" resolves to the right day server-side. */
  focusPlanDayId?: string;
}

/** Refresh proposal/plan queries when a stream carried a planProposal frame. */
function handleStreamPlanProposal(extras: Record<string, unknown>): void {
  const proposal = extras.planProposal as PlanProposalView | undefined;
  if (!proposal) return;
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.planProposalPending }).catch(() => {});
  if (proposal.status === "applied") {
    // Auto-apply mode already mutated the plan during the stream.
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.plans }).catch(() => {});
  }
}

const DEFAULT_WELCOME = "hey. i'm your ai training coach. ask me about pacing, sessions, or anything you're training for — running, functional fitness, hyrox, the lot.";
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_CHARS = 30000;
const TRUNCATED_MSG_LENGTH = 200;
const STICKY_SCROLL_THRESHOLD_PX = 48;

function truncateHistory(history: { role: string; content: string }[]): { role: string; content: string }[] {
  let totalChars = 0;
  for (const msg of history) {
    totalChars += msg.content.length;
  }
  if (totalChars <= MAX_HISTORY_CHARS) return history;

  // Walk backward, preserving recent messages in full
  const result = [...history];
  let budget = MAX_HISTORY_CHARS;
  for (let i = result.length - 1; i >= 0; i--) {
    if (budget >= result[i].content.length) {
      budget -= result[i].content.length;
    } else {
      result[i] = {
        ...result[i],
        content: result[i].content.slice(0, TRUNCATED_MSG_LENGTH) + " [truncated]",
      };
      budget = 0;
    }
  }
  return result;
}

export function useChatSession(options: UseChatSessionOptions = {}) {
  const {
    welcomeMessage = DEFAULT_WELCOME,
    useStreaming = true,
    focusPlanDayId,
  } = options;

  const welcomeMessageObj: Message = useMemo(() => ({
    id: "welcome",
    role: "assistant",
    content: welcomeMessage,
    timestamp: getCurrentTimeString(),
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
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const messagesRef = useRef<Message[]>(messages);
  const isSubmittingRef = useRef(false);
  const streamControllerRef = useRef<AbortController | null>(null);
  // Monotonic id bumped per send. A flush from a superseded stream (e.g. a
  // requestAnimationFrame flush scheduled just before a disconnect/reconnect)
  // carries a stale id and is ignored, so it can't overwrite the live stream's
  // state (W14).
  const streamGenerationRef = useRef(0);

  useEffect(() => () => {
    // Abort any in-flight stream on unmount so the rAF / setState in
    // consumeSSEStream don't fire against an unmounted tree.
    streamControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Chat history is server-of-truth and bounded; useChatMutations.ts already
  // invalidates this key on save/clear. Disable background refetches so we
  // don't redo the fetch on every route change / focus / reconnect (W10).
  const { data: chatHistory = [], isLoading: historyLoading } = useQuery<DBChatMessage[]>({
    queryKey: QUERY_KEYS.chatHistory,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
    if (!historyLoading && chatHistory.length > 0 && !historyLoaded) {
      const loadedMessages: Message[] = chatHistory.map((msg) => ({
        id: msg.id,
        role: msg.role as "user" | "assistant",
        content: msg.content,
        timestamp: msg.timestamp
          ? formatTime(new Date(msg.timestamp))
          : "",
      }));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- One-time hydration from React Query into the editable chat buffer.
      setMessages([welcomeMessageObj, ...loadedMessages]);
      setHistoryLoaded(true);
    } else if (!historyLoading && chatHistory.length === 0 && !historyLoaded) {
      setHistoryLoaded(true);
    }
  }, [chatHistory, historyLoading, historyLoaded, welcomeMessageObj]);

  const saveMessageMutation = useSaveMessageMutation();

  const clearHistoryMutation = useClearHistoryMutation(() => {
    setMessages([welcomeMessageObj]);
    setHistoryLoaded(false);
  });

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  const updateAutoScrollMode = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    shouldAutoScrollRef.current = distanceFromBottom <= STICKY_SCROLL_THRESHOLD_PX;
  }, []);

  const scrollToBottomIfPinned = useCallback(() => {
    if (shouldAutoScrollRef.current) {
      scrollToBottom();
    }
  }, [scrollToBottom]);

  const pinAutoScroll = useCallback(() => {
    shouldAutoScrollRef.current = true;
  }, []);

  useEffect(() => {
    scrollToBottomIfPinned();
  }, [messages, scrollToBottomIfPinned]);

  const sendMessage = useCallback(async (content: string) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    // Claim this send's stream generation; later flushes check it (W14).
    const generationId = ++streamGenerationRef.current;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: getCurrentTimeString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    shouldAutoScrollRef.current = true;
    setIsLoading(true);
    // Clear any prior interruption announcement so the assertive region only
    // fires on a fresh failure (W8).
    setStreamError(null);

    // Pass each message's stable client id as an idempotency key so a retried
    // save (React Query retry, double-fire, offline replay) doesn't persist the
    // turn twice; the user/assistant ids differ so the pair stays ordered (S7).
    saveMessageMutation.mutate({ role: "user", content, idempotencyKey: userMessage.id });

    const assistantMessageId = crypto.randomUUID();
    let fullResponse = "";

    try {
      const history = truncateHistory(
        messagesRef.current
          .filter((m) => m.id !== "welcome")
          .map((m) => ({ role: m.role, content: m.content }))
          .slice(-MAX_HISTORY_MESSAGES)
      );

      if (useStreaming && supportsResponseStreaming()) {
        const placeholderMessage: Message = {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          timestamp: getCurrentTimeString(),
        };
        setMessages((prev) => [...prev, placeholderMessage]);

        const controller = new AbortController();
        streamControllerRef.current = controller;
        setIsStreaming(true);

        const response = await api.chat.sendStream(
          { message: content, history, ...(focusPlanDayId ? { focusPlanDayId } : {}) },
          { signal: controller.signal },
        );

        const reader = response.body?.getReader();

        if (!reader) {
          throw new Error("No response body");
        }

        // Capture the latest accumulated content on every flush so the catch
        // handler can persist a partial response after a Stop / network drop.
        // Without this, `fullResponse` is only assigned after consumeSSEStream
        // resolves — but abort throws first, so the partial would be lost.
        const updateMessage = createMessageUpdater(assistantMessageId, setMessages);
        const result = await consumeSSEStream<RagInfo>(reader, {
          metaKey: "ragInfo",
          extraKeys: ["planProposal", "planProposalPending"],
          signal: controller.signal,
          onFlush: (snapshot) => {
            // Drop flushes from a superseded stream so a stale rAF flush after
            // a reconnect can't clobber the current stream's state (W14).
            if (streamGenerationRef.current !== generationId) return;
            if (snapshot.extras.planProposalPending) setIsReviewingPlan(true);
            fullResponse = snapshot.content;
            updateMessage(snapshot);
          },
        });
        fullResponse = result.content;
        handleStreamPlanProposal(result.extras);

        if (fullResponse) {
          saveMessageMutation.mutate({ role: "assistant", content: fullResponse, idempotencyKey: assistantMessageId });
        }
      } else {
        const data = await api.chat.send({
          message: content,
          history
        });

        const assistantMessage: Message = {
          id: assistantMessageId,
          role: "assistant",
          content: data.response,
          timestamp: getCurrentTimeString(),
          ragInfo: data.ragInfo,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        saveMessageMutation.mutate({ role: "assistant", content: data.response, idempotencyKey: assistantMessageId });
      }
    } catch (err) {
      handleStreamError({
        err,
        fullResponse,
        assistantMessageId,
        setMessages,
        saveAssistantMessage: (content) =>
          saveMessageMutation.mutate({ role: "assistant", content, idempotencyKey: assistantMessageId }),
        setStreamError,
      });
    } finally {
      streamControllerRef.current = null;
      setIsStreaming(false);
      setIsLoading(false);
      setIsReviewingPlan(false);
      isSubmittingRef.current = false;
    }
  }, [useStreaming, saveMessageMutation, focusPlanDayId]);

  const cancelStream = useCallback(() => {
    streamControllerRef.current?.abort();
  }, []);

  const clearHistory = useCallback(() => {
    clearHistoryMutation.mutate();
  }, [clearHistoryMutation]);

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
    cancelStream,
    clearHistory,
    isClearingHistory: clearHistoryMutation.isPending,
    scrollToBottom,
    hasMessages: messages.length > 1,
  };
}
