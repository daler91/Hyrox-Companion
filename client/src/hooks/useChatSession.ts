import type { ChatMessage as DBChatMessage } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo,useRef, useState } from "react";

import { api, QUERY_KEYS, type RagInfo } from "@/lib/api";
import { formatTime,getCurrentTimeString } from "@/lib/dateUtils";
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
}

const DEFAULT_WELCOME = "hey. i'm your ai training coach. ask me about pacing, sessions, or anything you're training for — running, functional fitness, hyrox, the lot.";
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_CHARS = 30000;
const TRUNCATED_MSG_LENGTH = 200;

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
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>(messages);
  const isSubmittingRef = useRef(false);
  const streamControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    // Abort any in-flight stream on unmount so the rAF / setState in
    // consumeSSEStream don't fire against an unmounted tree.
    streamControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const { data: chatHistory = [], isLoading: historyLoading } = useQuery<DBChatMessage[]>({
    queryKey: QUERY_KEYS.chatHistory,
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

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async (content: string) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: getCurrentTimeString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    saveMessageMutation.mutate({ role: "user", content });

    const assistantMessageId = crypto.randomUUID();
    let fullResponse = "";

    try {
      const history = truncateHistory(
        messagesRef.current
          .filter((m) => m.id !== "welcome")
          .map((m) => ({ role: m.role, content: m.content }))
          .slice(-MAX_HISTORY_MESSAGES)
      );

      if (useStreaming) {
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
          { message: content, history },
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
          signal: controller.signal,
          onFlush: (snapshot) => {
            fullResponse = snapshot.content;
            updateMessage(snapshot);
          },
        });
        fullResponse = result.content;

        if (fullResponse) {
          saveMessageMutation.mutate({ role: "assistant", content: fullResponse });
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
        saveMessageMutation.mutate({ role: "assistant", content: data.response });
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      const isNetwork = err instanceof TypeError; // fetch throws TypeError on network failure
      const suffix = isAbort
        ? "\n\n(Stopped)"
        : isNetwork
          ? "\n\n(Connection lost — check your internet)"
          : "\n\n(Stream interrupted)";

      if (fullResponse) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? { ...m, content: fullResponse + suffix }
              : m
          )
        );
        if (isAbort) {
          // Persist the partial so the user doesn't lose it on reload
          saveMessageMutation.mutate({ role: "assistant", content: fullResponse });
        }
      } else {
        const body = isAbort
          ? "Stopped."
          : isNetwork
            ? "Your connection dropped. Check your internet and try again."
            : "Something went wrong on our side. Please try again.";
        const errorMessage: Message = {
          id: assistantMessageId,
          role: "assistant",
          content: body,
          timestamp: getCurrentTimeString(),
        };
        setMessages((prev) => {
          const withoutPlaceholder = prev.filter(m => m.id !== assistantMessageId);
          return [...withoutPlaceholder, errorMessage];
        });
      }
    } finally {
      streamControllerRef.current = null;
      setIsStreaming(false);
      setIsLoading(false);
      isSubmittingRef.current = false;
    }
  }, [useStreaming, saveMessageMutation]);

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
    historyLoading,
    scrollRef,
    sendMessage,
    cancelStream,
    clearHistory,
    isClearingHistory: clearHistoryMutation.isPending,
    scrollToBottom,
    hasMessages: messages.length > 1,
  };
}
