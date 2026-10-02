import { api, type ChatFocus, type ChatTurnIds, QUERY_KEYS, type RagInfo } from "@/lib/api";
import { createLocalMessage, type Message } from "@/lib/chatMessage";
import { queryClient } from "@/lib/queryClient";
import { consumeSSEStream } from "@/lib/sseStream";

import {
  createMessageUpdater,
  ignoreResult,
  isChatSafetyNotice,
  isPlanProposalView,
  type SetMessages,
} from "./chatSessionModel";

/**
 * One chat request: the message, the workout in view, and the ids the server
 * saves both turns under. The reply fills the bubble with `ids.assistantMessageId`.
 */
export interface ChatReplyRequest {
  content: string;
  /** The workout in view in the workout-detail chat. */
  focus?: ChatFocus;
  ids: ChatTurnIds;
}

export interface StreamChatReplyOptions extends ChatReplyRequest {
  signal: AbortSignal;
  setMessages: SetMessages;
  /** False once a newer send has started: its flushes are dropped (W14). */
  isCurrent: () => boolean;
  /** The server accepted the request: its headers arrived. */
  onAccepted: (response: Response) => void;
  /** The server is drafting a plan proposal instead of prose. */
  onReviewingPlan: () => void;
  /**
   * The text so far, on every flush. The caller keeps it so a Stop or a
   * dropped connection — which reject before this resolves — still leave the
   * partial reply in its bubble.
   */
  onText: (content: string) => void;
}

// S9 — the streaming path relies on fetch + Response.body (ReadableStream),
// which is absent on very old WebKit (iOS Safari < 10.3). Feature-detect so
// those clients fall back to the non-streaming /api/v1/chat request instead of
// throwing "No response body".
export function supportsResponseStreaming(): boolean {
  return typeof ReadableStream !== "undefined";
}

/**
 * The server saved this send's turns. Any chat surface mounted from now on
 * loads them; the ones already open keep their own buffer.
 */
export function refreshSavedConversation(): void {
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.chatHistory }).catch(ignoreResult);
}

/** Refresh proposal/plan queries when a stream carried a planProposal frame. */
function handleStreamPlanProposal(extras: Record<string, unknown>): void {
  const proposal = extras.planProposal;
  if (!isPlanProposalView(proposal)) return;
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.planProposalPending }).catch(ignoreResult);
  // A new proposal replaces the pending one: its card, wherever it is in the
  // chat, re-reads its status.
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.planProposalPrefix }).catch(ignoreResult);
  if (proposal.status === "applied") {
    // Auto-apply mode already mutated the plan during the stream.
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(ignoreResult);
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.plans }).catch(ignoreResult);
  }
}

/**
 * Send one message to /api/v1/chat/stream and stream the reply into its
 * bubble. Resolves with the reply's full text; rejects on a refused request,
 * a dropped connection, a server error event, or a Stop.
 */
export async function streamChatReply(options: StreamChatReplyOptions): Promise<string> {
  const { content, focus, ids, signal, setMessages } = options;
  const response = await api.chat.sendStream({ message: content, ...focus, ...ids }, { signal });
  options.onAccepted(response);

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const updateMessage = createMessageUpdater(ids.assistantMessageId, setMessages);
  const result = await consumeSSEStream<RagInfo>(reader, {
    metaKey: "ragInfo",
    extraKeys: ["planProposal", "planProposalPending", "safetyNotice", "factProposal"],
    signal,
    onFlush: (snapshot) => {
      // Drop flushes from a superseded stream so a stale rAF flush after a
      // reconnect can't clobber the current stream's state (W14).
      if (!options.isCurrent()) return;
      if (snapshot.extras.planProposalPending) options.onReviewingPlan();
      options.onText(snapshot.content);
      updateMessage(snapshot);
    },
  });
  handleStreamPlanProposal(result.extras);
  return result.content;
}

/** The non-streaming fallback (S9): one request, the whole reply as a message. */
export async function fetchChatReply({ content, focus, ids }: ChatReplyRequest): Promise<Message> {
  const data = await api.chat.send({ message: content, ...focus, ...ids });
  return {
    ...createLocalMessage("assistant", data.response, ids.assistantMessageId),
    ragInfo: data.ragInfo,
    ...(isChatSafetyNotice(data.safetyNotice) ? { safetyNotice: data.safetyNotice } : {}),
  };
}
