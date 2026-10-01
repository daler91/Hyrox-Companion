import type { ChatMessage as DBChatMessage } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo,useRef, useState } from "react";

import { useToast } from "@/hooks/use-toast";
import { api, type PlanProposalView, QUERY_KEYS, type RagInfo } from "@/lib/api";
import { describeChatFailure } from "@/lib/chatErrors";
import { createLocalMessage, type Message, type MessageFailure } from "@/lib/chatMessage";
import { formatTime,getCurrentTimeString } from "@/lib/dateUtils";
import { queryClient } from "@/lib/queryClient";
import { consumeSSEStream } from "@/lib/sseStream";

import { useClearHistoryMutation,useSaveMessageMutation } from "./useChatMutations";

export type { RagInfo } from "@/lib/api";
export type { Message } from "@/lib/chatMessage";

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

// S9 — the streaming path relies on fetch + Response.body (ReadableStream),
// which is absent on very old WebKit (iOS Safari < 10.3). Feature-detect so
// those clients fall back to the non-streaming /api/v1/chat request instead of
// throwing "No response body".
function supportsResponseStreaming(): boolean {
  return typeof ReadableStream !== "undefined";
}

interface SavedTurn {
  role: "user" | "assistant";
  content: string;
  idempotencyKey: string;
}

/** Saves one send's two turns, in order, once the server has accepted it. */
interface TurnSaver {
  /** Save the athlete's turn (at most once). Call when the server accepts the request. */
  saveUser: () => Promise<void>;
  /** Save the coach's reply, after the athlete's turn. */
  saveAssistant: (reply: string) => void;
  /** Whether the athlete's turn has been saved, now or on an earlier attempt. */
  userSaved: () => boolean;
}

function createTurnSaver(
  saveTurn: (turn: SavedTurn) => Promise<void>,
  userMessage: Message,
  assistantMessageId: string,
  userAlreadySaved: boolean,
): TurnSaver {
  let userSave: Promise<void> | null = userAlreadySaved ? Promise.resolve() : null;
  const saveUser = () => {
    userSave ??= saveTurn({ role: "user", content: userMessage.content, idempotencyKey: userMessage.id });
    return userSave;
  };
  return {
    saveUser,
    saveAssistant: (reply) => {
      void saveUser().then(() =>
        saveTurn({ role: "assistant", content: reply, idempotencyKey: assistantMessageId }),
      );
    },
    userSaved: () => userSave !== null,
  };
}

interface HandleSendFailureArgs {
  err: unknown;
  fullResponse: string;
  assistantMessageId: string;
  userMessage: Message;
  turns: TurnSaver;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setStreamError: (message: string | null) => void;
}

/**
 * Reconcile chat UI + persistence when a send rejects, before or during the
 * stream. The reply keeps whatever text arrived and carries the failure as a
 * note (with Retry when sending again could help); the note is UI only, so it
 * never reaches the model as something the coach said.
 */
function handleSendFailure({
  err,
  fullResponse,
  assistantMessageId,
  userMessage,
  turns,
  setMessages,
  setStreamError,
}: HandleSendFailureArgs): void {
  const description = describeChatFailure(err);

  // Announce the interruption assertively (W8). The description is already
  // phrased for a human, so it doubles as the spoken announcement.
  setStreamError(description.message);

  // Keep a reply the athlete stopped part-way, so it survives a reload.
  if (description.aborted && fullResponse) turns.saveAssistant(fullResponse);

  const failure: MessageFailure = {
    message: description.message,
    ...(description.retryable
      ? {
          retry: {
            content: userMessage.content,
            userMessageId: userMessage.id,
            userSaved: turns.userSaved(),
          },
        }
      : {}),
  };
  setMessages((prev) => {
    if (!prev.some((m) => m.id === assistantMessageId)) {
      return [...prev, { ...createLocalMessage("assistant", fullResponse, assistantMessageId), failure }];
    }
    return prev.map((m) => (m.id === assistantMessageId ? { ...m, content: fullResponse, failure } : m));
  });
}

interface UseChatSessionOptions {
  welcomeMessage?: string;
  useStreaming?: boolean;
  /** Plan day in view when chatting from the workout-detail dialog, so
   * "make this day easier" resolves to the right day server-side. */
  focusPlanDayId?: string;
}

interface SendMessageOptions {
  /** The server accepted, and the client saved, this turn on an earlier attempt. */
  userAlreadySaved?: boolean;
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

/**
 * The conversation as the model should see it: no welcome, and no reply that
 * failed before any text arrived — its failure note is UI, not something the
 * coach said (and the server rejects empty turns).
 */
function buildHistory(messages: Message[]): { role: string; content: string }[] {
  return truncateHistory(
    messages
      .filter((m) => m.id !== "welcome" && m.content.trim() !== "")
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-MAX_HISTORY_MESSAGES),
  );
}

const noop = () => {};

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
        // Older than anything created in this session, so it sorts first. Not
        // derived from msg.timestamp: that is the server's clock, and a client
        // clock running behind it would sort this session's new turns above
        // the history they follow.
        createdAtMs: 0,
      }));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- One-time hydration from React Query into the editable chat buffer.
      setMessages([welcomeMessageObj, ...loadedMessages]);
      setHistoryLoaded(true);
    } else if (!historyLoading && chatHistory.length === 0 && !historyLoaded) {
      setHistoryLoaded(true);
    }
  }, [chatHistory, historyLoading, historyLoaded, welcomeMessageObj]);

  const saveMessageMutation = useSaveMessageMutation();
  // Saves never fail the chat turn: a lost save costs that turn on reload, as
  // it always has, not the reply the athlete is reading.
  const saveTurn = useCallback(
    (turn: SavedTurn): Promise<void> => saveMessageMutation.mutateAsync(turn).then(noop, noop),
    [saveMessageMutation],
  );

  const { toast } = useToast();
  const budgetWarnedRef = useRef(false);
  // aiBudgetCheck sets this header once the athlete has spent most of their
  // rolling 24-hour allowance; say so once, before the limit stops the chat.
  const warnIfNearBudget = useCallback(
    (response: Response) => {
      if (budgetWarnedRef.current || response.headers.get("X-AI-Budget-Warning") !== "true") return;
      budgetWarnedRef.current = true;
      toast({
        title: "Nearly at today's AI limit",
        description: "Your AI allowance resets on a rolling 24-hour basis.",
      });
    },
    [toast],
  );

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

  const sendMessage = useCallback(async (content: string, sendOptions: SendMessageOptions = {}) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    // Claim this send's stream generation; later flushes check it (W14).
    const generationId = ++streamGenerationRef.current;

    const userMessage = createLocalMessage("user", content);
    setMessages((prev) => [...prev, userMessage]);
    shouldAutoScrollRef.current = true;
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
    let fullResponse = "";

    try {
      const history = buildHistory(messagesRef.current);

      if (useStreaming && supportsResponseStreaming()) {
        setMessages((prev) => [...prev, createLocalMessage("assistant", "", assistantMessageId)]);

        const controller = new AbortController();
        streamControllerRef.current = controller;
        setIsStreaming(true);

        const response = await api.chat.sendStream(
          { message: content, history, ...(focusPlanDayId ? { focusPlanDayId } : {}) },
          { signal: controller.signal },
        );
        void turns.saveUser();
        warnIfNearBudget(response);

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

        if (fullResponse) turns.saveAssistant(fullResponse);
      } else {
        const data = await api.chat.send({
          message: content,
          history
        });

        const assistantMessage: Message = {
          ...createLocalMessage("assistant", data.response, assistantMessageId),
          ragInfo: data.ragInfo,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        turns.saveAssistant(data.response);
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
  }, [useStreaming, saveTurn, warnIfNearBudget, focusPlanDayId]);

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
    void sendMessage(retry.content, { userAlreadySaved: retry.userSaved });
  }, [sendMessage]);

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
    retryMessage,
    cancelStream,
    clearHistory,
    isClearingHistory: clearHistoryMutation.isPending,
    scrollToBottom,
    hasMessages: messages.length > 1,
  };
}
