import type { ChatMessage, ChatSafetyNotice, CoachingMaterial, RagInfo } from "@shared/schema";

import { rawRequest,typedRequest } from "./client";

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

/** The workout in view when chatting from the workout-detail dialog. */
export interface ChatFocus {
  /** Its plan day, so "make this day easier" resolves to it. */
  focusPlanDayId?: string;
  /** Its log, when the session has been done. */
  focusWorkoutLogId?: string;
}

export const chat = {
  sendStream: (
    data: {
      message: string;
      history?: Array<{ role: string; content: string }>;
      /** Opt-out for surfaces without proposal-card UI (server defaults true). */
      planEditing?: boolean;
    } & ChatFocus,
    options?: { signal?: AbortSignal },
  ) =>
    rawRequest("POST", "/api/v1/chat/stream", data, {
      // Long-lived stream — the timeout only gates the initial Response,
      // not the body, but bump it anyway so a slow Gemini start doesn't
      // cut off before the first chunk.
      timeoutMs: 60_000,
      signal: options?.signal,
    }),

  send: (data: { message: string; history?: Array<{ role: string; content: string }> } & ChatFocus) =>
    typedRequest<ChatResponse>("POST", "/api/v1/chat", data),

  // The per-message idempotencyKey (the client message id) is sent as
  // X-Idempotency-Key so a retried/duplicated save is de-duplicated by the
  // existing idempotency middleware rather than persisting the turn twice (S7).
  saveMessage: (msg: { role: string; content: string }, idempotencyKey?: string) =>
    typedRequest<ChatMessage>(
      "POST",
      "/api/v1/chat/message",
      msg,
      idempotencyKey ? { headers: { "X-Idempotency-Key": idempotencyKey } } : undefined,
    ),

  clearHistory: () => typedRequest<{ success: boolean }>("DELETE", "/api/v1/chat/history"),

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

  create: (data: { title: string; content: string; type: "principles" | "document" }) =>
    typedRequest<CoachingMaterial>("POST", "/api/v1/coaching-materials", data),

  delete: (id: string) => typedRequest<{ success: boolean }>("DELETE", `/api/v1/coaching-materials/${id}`),

  getRagStatus: () => typedRequest<RagStatus>("GET", "/api/v1/coaching-materials/rag-status"),

  reEmbed: () => typedRequest<ReEmbedResponse>("POST", "/api/v1/coaching-materials/re-embed"),
} as const;
