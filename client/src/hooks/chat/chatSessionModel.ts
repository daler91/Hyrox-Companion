import type { ChatSafetyNotice } from "@shared/schema";
import type { Dispatch, SetStateAction } from "react";

import type { ChatHistoryMessage, PlanProposalView, RagInfo } from "@/lib/api";
import { describeChatFailure } from "@/lib/chatErrors";
import { createLocalMessage, type Message, type MessageFailure } from "@/lib/chatMessage";
import { formatTime } from "@/lib/dateUtils";

/**
 * The pure pieces of a coach chat session — how a saved row becomes a
 * message, how stream events land on the reply, and how a failed send reads —
 * kept out of the hooks so each can be tested on its own. The server owns the
 * conversation: it saves both turns and reads the history itself, so nothing
 * here builds history or saves turns.
 */

export type SetMessages = Dispatch<SetStateAction<Message[]>>;

/**
 * For a promise whose failure is already handled, or deliberately dropped:
 * it settles to nothing, and the promise doesn't float unhandled.
 */
export const ignoreResult = (): undefined => undefined;

export function isChatSafetyNotice(value: unknown): value is ChatSafetyNotice {
  if (typeof value !== "object" || value === null) return false;
  const { level, message } = value as Record<string, unknown>;
  return (level === "urgent" || level === "caution") && typeof message === "string" && message !== "";
}

/** Enough of a proposal to render its card; the rest is the server's own serializer. */
export function isPlanProposalView(value: unknown): value is PlanProposalView {
  if (typeof value !== "object" || value === null) return false;
  const { id, status, changes } = value as Record<string, unknown>;
  return typeof id === "string" && typeof status === "string" && Array.isArray(changes);
}

/**
 * A saved row as a chat bubble. `createdAtMs` stays 0, older than anything
 * created in this session, so it sorts first in the Coach panel: it is the
 * server's clock, and a client clock running behind it would sort this
 * session's new turns above the history they follow. `sentAtMs` keeps the
 * real time for the date separators.
 */
export function messageFromHistory(row: ChatHistoryMessage): Message {
  const sentAt = row.timestamp ? new Date(row.timestamp) : undefined;
  return {
    id: row.id,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    timestamp: sentAt ? formatTime(sentAt) : "",
    createdAtMs: 0,
    ...(sentAt ? { sentAtMs: sentAt.getTime() } : {}),
    ...(row.kind === "proposal" || row.kind === "summary" ? { kind: row.kind } : {}),
    ...(row.ragInfo ? { ragInfo: row.ragInfo } : {}),
    ...(isChatSafetyNotice(row.safetyNotice) ? { safetyNotice: row.safetyNotice } : {}),
    ...(isPlanProposalView(row.proposal) ? { proposal: row.proposal } : {}),
  };
}

/** What a stream's extra events put on the reply: the safety notice, and the proposal it drafted. */
function streamExtras(extras: Record<string, unknown> | undefined): Partial<Message> {
  const safetyNotice = extras?.safetyNotice;
  const proposal = extras?.planProposal;
  return {
    ...(isChatSafetyNotice(safetyNotice) ? { safetyNotice } : {}),
    ...(isPlanProposalView(proposal) ? { proposal, kind: "proposal" as const } : {}),
  };
}

export function createMessageUpdater(assistantMessageId: string, setMessages: SetMessages) {
  return (snapshot: { content: string; meta?: RagInfo; extras?: Record<string, unknown> }) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantMessageId
          ? {
              ...m,
              content: snapshot.content,
              ...(snapshot.meta ? { ragInfo: snapshot.meta } : {}),
              ...streamExtras(snapshot.extras),
            }
          : m,
      ),
    );
  };
}

interface HandleSendFailureArgs {
  err: unknown;
  fullResponse: string;
  assistantMessageId: string;
  userMessage: Message;
  setMessages: SetMessages;
  setStreamError: (message: string | null) => void;
}

/**
 * Reconcile the chat UI when a send rejects, before or during the stream. The
 * reply keeps whatever text arrived and carries the failure as a note (with
 * Retry when sending again could help); the note is UI only. The server has
 * already saved what it accepted, including a reply cut off part-way.
 */
export function handleSendFailure({
  err,
  fullResponse,
  assistantMessageId,
  userMessage,
  setMessages,
  setStreamError,
}: HandleSendFailureArgs): void {
  const description = describeChatFailure(err);

  // Announce the interruption assertively (W8). The description is already
  // phrased for a human, so it doubles as the spoken announcement.
  setStreamError(description.message);

  const failure: MessageFailure = {
    message: description.message,
    ...(description.retryable
      ? { retry: { content: userMessage.content, userMessageId: userMessage.id } }
      : {}),
  };
  setMessages((prev) => {
    if (!prev.some((m) => m.id === assistantMessageId)) {
      return [...prev, { ...createLocalMessage("assistant", fullResponse, assistantMessageId), failure }];
    }
    return prev.map((m) => (m.id === assistantMessageId ? { ...m, content: fullResponse, failure } : m));
  });
}
