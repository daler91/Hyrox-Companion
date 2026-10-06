import type {
  AthleteFact,
  ChatFactProposal,
  ChatFeedback,
  ChatMessage,
  ChatPhoto,
  ChatSafetyNotice,
  CoachingMaterial,
  CoachingMaterialSummary,
  CoachWelcome,
  RagInfo,
} from "@shared/schema";

import { rawRequest,typedRequest } from "./client";
import { AI_REQUEST_OPTIONS } from "./constants";
import type { PlanProposalView } from "./planProposals";

export type { RagInfo } from "@shared/schema";

export interface RagStatus {
  hasApiKey: boolean;
  totalMaterials: number;
  totalChunks: number;
  allEmbedded: boolean;
  materials: {
    id: string;
    title: string;
    type: string;
    contentLength: number;
    chunkCount: number;
    hasEmbeddings: boolean;
  }[];
  storedDimension: number | null;
  expectedDimension: number;
  dimensionMismatch: boolean;
  embeddingApi: { ok: boolean; dimension?: number; error?: string };
}

interface ReEmbedResponse {
  success: boolean;
  materialsProcessed: number;
  errors: string[];
}

interface ChatResponse {
  response: string;
  ragInfo?: RagInfo;
  safetyNotice?: ChatSafetyNotice;
}

export interface CoachInsightsResponse {
  // null when the athlete has never generated insights — the GET surfaces the
  // stored result (or this empty sentinel) without spending AI.
  insights: string | null;
  ragInfo?: RagInfo;
  generatedAt?: string;
  /** True when a workout was logged after these insights were generated. */
  stale?: boolean;
}

/**
 * The ids that hand a chat turn to the server (AI coach chat review, I1). It
 * saves the athlete's message and the coach's reply under them and reads the
 * conversation from its own history, so the client sends neither the history
 * nor the turns. A retry sends the same userMessageId and the failed reply's
 * id, which the server replaces.
 */
export interface ChatTurnIds {
  userMessageId: string;
  assistantMessageId: string;
  replaceAssistantId?: string;
}

/** A saved chat row as GET /chat/history returns it: a proposal reply carries its proposal, with its current status. */
export type ChatHistoryMessage = ChatMessage & { proposal?: PlanProposalView };

/** The workout in view when chatting from the workout-detail dialog. */
export interface ChatFocus {
  /** Its plan day, so "make this day easier" resolves to it. */
  focusPlanDayId?: string;
  /** Its log, when the session has been done. */
  focusWorkoutLogId?: string;
}

/**
 * Where the next older page of chat history starts: the server's
 * `X-Next-Cursor` (a timestamp) and `X-Next-Cursor-Id` (a row id), sent back
 * together as `before` and `beforeId`.
 */
export interface ChatHistoryCursor {
  before: string;
  beforeId: string;
}

/** One page of a conversation, oldest row first. */
export interface ChatHistoryPage {
  messages: ChatHistoryMessage[];
  /** null once the page reaches the conversation's first message. */
  nextCursor: ChatHistoryCursor | null;
}

function chatHistoryUrl(focus: ChatFocus, cursor: ChatHistoryCursor | null): string {
  const params = new URLSearchParams();
  if (focus.focusPlanDayId) params.set("focusPlanDayId", focus.focusPlanDayId);
  if (focus.focusWorkoutLogId) params.set("focusWorkoutLogId", focus.focusWorkoutLogId);
  if (cursor) {
    params.set("before", cursor.before);
    params.set("beforeId", cursor.beforeId);
  }
  const search = params.toString();
  return search ? `/api/v1/chat/history?${search}` : "/api/v1/chat/history";
}

/** The older-page cursor a history response carries, when it carries both halves. */
function readChatHistoryCursor(headers: Headers): ChatHistoryCursor | null {
  const before = headers.get("X-Next-Cursor");
  const beforeId = headers.get("X-Next-Cursor-Id");
  return before && beforeId ? { before, beforeId } : null;
}

/**
 * One page of the saved conversation: a workout's own thread when `focus`
 * names it, the general one otherwise (I4). Without a cursor, the newest
 * page. The client never read the cursor headers, so every message older than
 * the newest 50 rows was out of reach. CL56 (CODEBASE_ANALYSIS_2026-10-03)
 */
async function getChatHistoryPage(
  focus: ChatFocus = {},
  cursor: ChatHistoryCursor | null = null,
): Promise<ChatHistoryPage> {
  const res = await rawRequest("GET", chatHistoryUrl(focus, cursor));
  const messages = (await res.json()) as ChatHistoryMessage[];
  return { messages, nextCursor: readChatHistoryCursor(res.headers) };
}

export const chat = {
  sendStream: (
    data: {
      message: string;
      /** Opt-out for surfaces without proposal-card UI (server defaults true). */
      planEditing?: boolean;
      /** One photo with the message, read for the coach and never stored (I20). */
      photo?: ChatPhoto;
    } & ChatFocus & ChatTurnIds,
    options?: { signal?: AbortSignal },
  ) =>
    rawRequest("POST", "/api/v1/chat/stream", data, {
      // Long-lived stream — the timeout only gates the initial Response,
      // not the body, but bump it anyway so a slow Gemini start doesn't
      // cut off before the first chunk.
      timeoutMs: 60_000,
      signal: options?.signal,
    }),

  // The non-streaming fallback waits for the whole AI reply, so it gets the
  // server's AI budget rather than the 15 s default (CL26, CODEBASE_ANALYSIS_2026-10-03).
  send: (data: { message: string; photo?: ChatPhoto } & ChatFocus & ChatTurnIds) =>
    typedRequest<ChatResponse>("POST", "/api/v1/chat", data, AI_REQUEST_OPTIONS),

  // Turns the chat routes don't save themselves: the Coach panel's own
  // messages (a suggestions request, an apply confirmation). The per-message
  // idempotencyKey (the client message id) is sent as
  // X-Idempotency-Key so a retried/duplicated save is de-duplicated by the
  // existing idempotency middleware rather than persisting the turn twice (S7).
  saveMessage: (msg: { role: string; content: string }, idempotencyKey?: string) =>
    typedRequest<ChatMessage>(
      "POST",
      "/api/v1/chat/message",
      msg,
      idempotencyKey ? { headers: { "X-Idempotency-Key": idempotencyKey } } : undefined,
    ),

  /**
   * The newest page of the saved conversation: a workout's own thread when
   * `focus` names it, the general one otherwise (AI coach chat review, I4).
   * `onNextCursor` is told where the next older page starts (CL56).
   */
  getHistory: async (
    focus: ChatFocus = {},
    onNextCursor?: (cursor: ChatHistoryCursor | null) => void,
  ) => {
    const page = await getChatHistoryPage(focus);
    onNextCursor?.(page.nextCursor);
    return page.messages;
  },

  getHistoryPage: getChatHistoryPage,

  clearHistory: () => typedRequest<{ success: boolean }>("DELETE", "/api/v1/chat/history"),

  /** The coach's opening line and prompt chips, from the athlete's training. */
  getWelcome: () => typedRequest<CoachWelcome>("GET", "/api/v1/chat/welcome"),

  /** Rate one of the coach's saved replies, or clear the rating with null (I23). */
  setFeedback: (id: string, feedback: ChatFeedback | null) =>
    typedRequest<{ id: string; feedback: ChatFeedback | null }>(
      "PATCH",
      `/api/v1/chat/messages/${encodeURIComponent(id)}`,
      { feedback },
    ),

  /** The athlete's answer to a fact the coach offered under a reply: save it to their card, or not now (I5b). */
  decideFactProposal: (id: string, decision: "save" | "dismiss") =>
    typedRequest<{ factProposal: ChatFactProposal; fact?: AthleteFact }>(
      "POST",
      `/api/v1/chat/messages/${encodeURIComponent(id)}/fact`,
      { decision },
    ),

  // Fetch the LAST stored insights (no AI spend) so the tab paints instantly on
  // open. Returns `{ insights: null }` when never generated.
  getStoredCoachInsights: () =>
    typedRequest<CoachInsightsResponse>("GET", "/api/v1/coach-insights"),

  // Regenerate (and persist) fresh insights. Builds full training + RAG context
  // and uses a reasoning AI model; matches the timeline-suggestions budget so it
  // doesn't time out before the first token.
  regenerateCoachInsights: () =>
    typedRequest<CoachInsightsResponse>("POST", "/api/v1/coach-insights", {}, {
      timeoutMs: 90_000,
    }),
} as const;

export const coaching = {
  list: () => typedRequest<CoachingMaterial[]>("GET", "/api/v1/coaching-materials"),

  /** Each material's title, type and length, without its text (PF4). */
  listSummaries: () =>
    typedRequest<CoachingMaterialSummary[]>("GET", "/api/v1/coaching-materials/summaries"),

  create: (data: { title: string; content: string; type: "principles" | "document" }) =>
    typedRequest<CoachingMaterial>("POST", "/api/v1/coaching-materials", data),

  delete: (id: string) => typedRequest<{ success: boolean }>("DELETE", `/api/v1/coaching-materials/${id}`),

  getRagStatus: () => typedRequest<RagStatus>("GET", "/api/v1/coaching-materials/rag-status"),

  reEmbed: () => typedRequest<ReEmbedResponse>("POST", "/api/v1/coaching-materials/re-embed"),
} as const;
