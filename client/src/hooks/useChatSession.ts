import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, QUERY_KEYS, type RagInfo } from "@/lib/api";
import { useSaveMessageMutation, useClearHistoryMutation } from "./useChatMutations";
import { getCurrentTimeString, formatTime } from "@/lib/dateUtils";
import type { ChatMessage as DBChatMessage } from "@shared/schema";

export type { RagInfo } from "@/lib/api";

/** Parse SSE lines and accumulate text + ragInfo without triggering React state updates. */
function processStreamLines(
  lines: string[],
  acc: { content: string; ragInfo?: RagInfo },
): void {
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    let data: { ragInfo?: RagInfo; text?: string; error?: string };
    try {
      data = JSON.parse(line.slice(6)) as typeof data;
    } catch {
      continue;
    }
    if (data.ragInfo) {
      acc.ragInfo = data.ragInfo;
    }
    if (data.text) {
      acc.content += data.text;
    }
    if (data.error) {
      throw new Error(data.error);
    }
  }
}

/**
 * Read the SSE stream and batch state updates via requestAnimationFrame
 * so we flush at most once per frame instead of once per chunk.
 */
async function handleStreamResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  assistantMessageId: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
): Promise<string> {
  const acc = { content: "", ragInfo: undefined as RagInfo | undefined };
  let buffer = "";
  let rafId = 0;
  let dirty = false;

  const flush = () => {
    if (!dirty) return;
    dirty = false;
    const snapshot = { content: acc.content, ragInfo: acc.ragInfo };
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantMessageId
          ? { ...m, content: snapshot.content, ...(snapshot.ragInfo ? { ragInfo: snapshot.ragInfo } : {}) }
          : m,
      ),
    );
  };

  const scheduleFlush = () => {
    if (!dirty) {
      dirty = true;
      rafId = requestAnimationFrame(flush);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        processStreamLines(event.split("\n"), acc);
      }
      scheduleFlush();
    }

    if (buffer.trim()) {
      processStreamLines(buffer.split("\n"), acc);
    }
  } finally {
    // Always flush buffered content — preserves partial output on error paths
    cancelAnimationFrame(rafId);
    dirty = true;
    flush();
  }

  return acc.content;
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

const DEFAULT_WELCOME = "Hey! I'm your AI training coach. Ask me about pacing, training tips, or anything Hyrox-related!";
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
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>(messages);
  const isSubmittingRef = useRef(false);

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

        const response = await api.chat.sendStream({
          message: content,
          history
        });

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error("No response body");
        }

        fullResponse = await handleStreamResponse(reader, decoder, assistantMessageId, setMessages);

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
    } catch {
      // Ignore detailed errors in the UI, just show interruption message
      if (fullResponse) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? { ...m, content: fullResponse + "\n\n(Stream interrupted)" }
              : m
          )
        );
      } else {
        const errorMessage: Message = {
          id: assistantMessageId,
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
          timestamp: getCurrentTimeString(),
        };
        setMessages((prev) => {
          const withoutPlaceholder = prev.filter(m => m.id !== assistantMessageId);
          return [...withoutPlaceholder, errorMessage];
        });
      }
    } finally {
      setIsLoading(false);
      isSubmittingRef.current = false;
    }
  }, [useStreaming, saveMessageMutation]);

  const clearHistory = useCallback(() => {
    clearHistoryMutation.mutate();
  }, [clearHistoryMutation]);

  return {
    messages,
    isLoading,
    historyLoading,
    scrollRef,
    sendMessage,
    clearHistory,
    isClearingHistory: clearHistoryMutation.isPending,
    scrollToBottom,
    hasMessages: messages.length > 1,
  };
}
