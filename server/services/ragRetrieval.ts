import { logger } from "../logger";
import { storage } from "../storage";
import { EMBEDDING_DIMENSIONS } from "../gemini/client";
import { buildCoachingMaterialsSection, buildRetrievedChunksSection, type CoachingMaterialInput } from "../prompts";
import { retrieveRelevantChunks } from "./ragService";
import type { RagInfo } from "@shared/schema";

/** Minimal logger interface for request-scoped logging. */
type Log = Pick<typeof logger, "warn" | "info" | "error">;

/**
 * Full RAG context result with diagnostic info (used by chat endpoints).
 */
export interface RagContextResult {
  retrievedChunks?: string[];
  coachingMaterials?: CoachingMaterialInput[];
  ragInfo: RagInfo;
}

/**
 * Simplified RAG context result (used by auto-coach / suggestions).
 */
export interface CoachingTextResult {
  text: string | undefined;
  source: "rag" | "legacy" | null;
}

/**
 * Core RAG retrieval logic shared between chat endpoints and auto-coach.
 *
 * Attempts RAG vector search first. If RAG is unavailable or returns no results,
 * falls back to legacy full-text coaching materials.
 */
export async function retrieveCoachingContext(
  userId: string,
  query: string,
  log: Log = logger,
): Promise<RagContextResult> {
  let fallbackReason: string | undefined;

  try {
    const hasChunks = await storage.hasChunksForUser(userId);

    if (hasChunks) {
      const storedDim = await storage.getStoredEmbeddingDimension(userId);
      if (storedDim !== null && storedDim !== EMBEDDING_DIMENSIONS) {
        log.warn(
          { userId, storedDim, expectedDim: EMBEDDING_DIMENSIONS },
          "[rag] Embedding dimension mismatch — skipping RAG (re-embed via settings to fix)",
        );
        fallbackReason = `dimension_mismatch: stored=${storedDim}, expected=${EMBEDDING_DIMENSIONS}`;
      } else {
        const chunks = await retrieveRelevantChunks(userId, query);
        if (chunks.length > 0) {
          return {
            retrievedChunks: chunks,
            ragInfo: { source: "rag", chunkCount: chunks.length, chunks },
          };
        }
        fallbackReason = storedDim === null
          ? "no_embeddings: chunks exist but none have embeddings — click Re-embed All"
          : "no_matching_chunks: search returned 0 results";
        log.warn({ userId, storedDim, fallbackReason }, "[rag] Retrieval returned 0 chunks");
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    fallbackReason = `retrieval_error: ${errMsg}`;
    log.error({ err: error, userId }, "[rag] Retrieval failed, falling back to legacy");
  }

  const coachingMaterials = await storage.listCoachingMaterials(userId);
  return {
    coachingMaterials,
    ragInfo: {
      source: coachingMaterials.length > 0 ? "legacy" : "none",
      chunkCount: 0,
      materialCount: coachingMaterials.length,
      fallbackReason,
    },
  };
}

/**
 * Convenience wrapper that returns a pre-built coaching text string
 * (used by auto-coach and suggestion endpoints that don't need full RagInfo).
 */
export async function retrieveCoachingText(
  userId: string,
  query: string,
  log: Log = logger,
): Promise<CoachingTextResult> {
  const result = await retrieveCoachingContext(userId, query, log);

  if (result.retrievedChunks && result.retrievedChunks.length > 0) {
    return { text: buildRetrievedChunksSection(result.retrievedChunks), source: "rag" };
  }

  if (result.coachingMaterials && result.coachingMaterials.length > 0) {
    const text = buildCoachingMaterialsSection(result.coachingMaterials) || undefined;
    return { text, source: text ? "legacy" : null };
  }

  return { text: undefined, source: null };
}
