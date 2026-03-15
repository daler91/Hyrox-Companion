import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSaveMessageMutation, useClearHistoryMutation } from "./useChatMutations";
import { getCurrentTimeString, formatTime } from "@/lib/dateUtils";
import type { ChatMessage as DBChatMessage } from "@shared/schema";


function processStreamLines(
  lines: string[],
  currentResponse: string,
  assistantMessageId: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
): string {
  let updatedResponse = currentResponse;
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    let data;
    try {
      data = JSON.parse(line.slice(6));
    } catch (parseError) {
      continue;
    }
    if (data.text) {
      updatedResponse += data.text;
      const newResponse = updatedResponse; // capture in closure
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? { ...m, content: newResponse }
            : m
        )
      );
    }
    if (data.error) {
      throw new Error(data.error);
    }
  }
  return updatedResponse;
}

async function handleStreamResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  assistantMessageId: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
): Promise<string> {
  let fullResponse = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const event of events) {
      const lines = event.split("\n");
      fullResponse = processStreamLines(lines, fullResponse, assistantMessageId, setMessages);
    }
  }

  if (buffer.trim()) {
    const lines = buffer.split("\n");
    fullResponse = processStreamLines(lines, fullResponse, assistantMessageId, setMessages);
  }

  return fullResponse;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface UseChatSessionOptions {
  welcomeMessage?: string;
  useStreaming?: boolean;
}

const DEFAULT_WELCOME = "Hey! I'm your AI training coach. Ask me about pacing, training tips, or anything Hyrox-related!";
const MAX_HISTORY_MESSAGES = 20;

export function useChatSession(options: UseChatSessionOptions = {}) {
  const { 
    welcomeMessage = DEFAULT_WELCOME,
    useStreaming = true,
  } = options;

  const welcomeMessageObj: Message = {
    id: "welcome",
    role: "assistant",
    content: welcomeMessage,
    timestamp: getCurrentTimeString(),
  };

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
    queryKey: ["/api/chat/history"],
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
  }, [chatHistory, historyLoading, historyLoaded]);

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
      const history = messagesRef.current
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }))
        .slice(-MAX_HISTORY_MESSAGES);

      if (useStreaming) {
        const placeholderMessage: Message = {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          timestamp: getCurrentTimeString(),
        };
        setMessages((prev) => [...prev, placeholderMessage]);

        const response = await apiRequest("POST", "/api/chat/stream", {
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
        const response = await apiRequest("POST", "/api/chat", { 
          message: content, 
          history 
        });
        const data = await response.json();

        const assistantMessage: Message = {
          id: assistantMessageId,
          role: "assistant",
          content: data.response,
          timestamp: getCurrentTimeString(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
        saveMessageMutation.mutate({ role: "assistant", content: data.response });
      }
    } catch {
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
