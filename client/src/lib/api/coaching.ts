import { typedRequest, rawRequest } from "./client";
import type { InsertCoachingMaterial, CoachingMaterial, ChatMessage } from "@shared/schema";

export interface RagInfo {
  source: "rag" | "legacy" | "none";
  chunkCount: number;
  chunks?: string[];
  materialCount?: number;
}

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
}

export const chat = {
  sendStream: (data: { message: string; history?: Array<{ role: string; content: string }> }) =>
    rawRequest("POST", "/api/v1/chat/stream", data),

  send: (data: { message: string; history?: Array<{ role: string; content: string }> }) =>
    typedRequest<ChatResponse>("POST", "/api/v1/chat", data),

  saveMessage: (msg: { role: string; content: string }) =>
    typedRequest<ChatMessage>("POST", "/api/v1/chat/message", msg),

  clearHistory: () => typedRequest<{ success: boolean }>("DELETE", "/api/v1/chat/history"),
} as const;

export const coaching = {
  list: () => typedRequest<CoachingMaterial[]>("GET", "/api/v1/coaching-materials"),

  create: (data: { title: string; content: string; type: "principles" | "document" }) =>
    typedRequest<CoachingMaterial>("POST", "/api/v1/coaching-materials", data),

  update: (id: string, data: Partial<InsertCoachingMaterial>) =>
    typedRequest<CoachingMaterial>("PATCH", `/api/v1/coaching-materials/${id}`, data),

  delete: (id: string) =>
    typedRequest<{ success: boolean }>("DELETE", `/api/v1/coaching-materials/${id}`),

  getRagStatus: () => typedRequest<RagStatus>("GET", "/api/v1/coaching-materials/rag-status"),

  reEmbed: () => typedRequest<ReEmbedResponse>("POST", "/api/v1/coaching-materials/re-embed"),
} as const;
