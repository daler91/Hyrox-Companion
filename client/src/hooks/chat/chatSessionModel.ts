import type { ChatSafetyNotice } from "@shared/schema";
import type { Dispatch, SetStateAction } from "react";

import type { RagInfo } from "@/lib/api";
import { describeChatFailure } from "@/lib/chatErrors";
import { createLocalMessage, type Message, type MessageFailure } from "@/lib/chatMessage";

/**
 * The pure pieces of a coach chat session — what the history sent to the
 * model contains, how a send's turns are saved, and how a failed send reads —
 * kept out of the hooks so each can be tested on its own.
 */

/** One turn as the chat request carries it. */
export interface HistoryTurn {
  role: string;
  content: string;
}

export type SetMessages = Dispatch<SetStateAction<Message[]>>;

/**
 * For a promise whose failure is already handled, or deliberately dropped:
 * it settles to nothing, and the promise doesn't float unhandled.
 */
export const ignoreResult = (): undefined => undefined;

const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_CHARS = 30000;
const TRUNCATED_MSG_LENGTH = 200;

export function truncateHistory(history: HistoryTurn[]): HistoryTurn[] {
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
        content: `${result[i].content.slice(0, TRUNCATED_MSG_LENGTH)} [truncated]`,
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
export function buildHistory(messages: Message[]): HistoryTurn[] {
  return truncateHistory(
    messages
      .filter((m) => m.id !== "welcome" && m.content.trim() !== "")
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-MAX_HISTORY_MESSAGES),
  );
}

export function isChatSafetyNotice(value: unknown): value is ChatSafetyNotice {
  if (typeof value !== "object" || value === null) return false;
  const { level, message } = value as Record<string, unknown>;
  return (level === "urgent" || level === "caution") && typeof message === "string" && message !== "";
}

export function createMessageUpdater(assistantMessageId: string, setMessages: SetMessages) {
  return (snapshot: { content: string; meta?: RagInfo; extras?: Record<string, unknown> }) => {
    const safetyNotice = snapshot.extras?.safetyNotice;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantMessageId
          ? {
              ...m,
              content: snapshot.content,
              ...(snapshot.meta ? { ragInfo: snapshot.meta } : {}),
              ...(isChatSafetyNotice(safetyNotice) ? { safetyNotice } : {}),
            }
          : m,
      ),
    );
  };
}

export interface SavedTurn {
  role: "user" | "assistant";
  content: string;
  idempotencyKey: string;
}

/** Saves one send's two turns, in order, once the server has accepted it. */
export interface TurnSaver {
  /** Save the athlete's turn (at most once). Call when the server accepts the request. */
  saveUser: () => Promise<void>;
  /** Save the coach's reply, after the athlete's turn. */
  saveAssistant: (reply: string) => void;
  /** Whether the athlete's turn has been saved, now or on an earlier attempt. */
  userSaved: () => boolean;
}

export function createTurnSaver(
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
      saveUser()
        .then(() => saveTurn({ role: "assistant", content: reply, idempotencyKey: assistantMessageId }))
        .catch(ignoreResult);
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
  setMessages: SetMessages;
  setStreamError: (message: string | null) => void;
}

/**
 * Reconcile chat UI + persistence when a send rejects, before or during the
 * stream. The reply keeps whatever text arrived and carries the failure as a
 * note (with Retry when sending again could help); the note is UI only, so it
 * never reaches the model as something the coach said.
 */
export function handleSendFailure({
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
