import type { CoachingMaterial } from "@shared/schema";
import pLimit from "p-limit";

import { env } from "../env";
import { EMBEDDING_DIMENSIONS,generateEmbedding, generateEmbeddings, trackEmbeddingUsage } from "../gemini/client";
import { logger } from "../logger";
import { storage } from "../storage";

// Bound concurrent Gemini + DB writes during bulk re-embed so a large
// tenant cannot burst-load the embedding provider or DB pool
// (CODEBASE_AUDIT.md §3).
const REEMBED_CONCURRENCY = 3;

// Cache the embedding-provider health probe so UI polling of getRagStatus
// does not issue a live generateEmbedding("test") call on every request
// (CODEBASE_AUDIT.md §3).
type EmbeddingHealth = { ok: boolean; dimension?: number; error?: string };
const EMBEDDING_HEALTH_TTL_MS = 5 * 60_000;
let cachedEmbeddingHealth: { value: EmbeddingHealth; at: number } | null = null;

async function probeEmbeddingHealth(): Promise<EmbeddingHealth> {
  try {
    const probe = await generateEmbedding("test");
    return { ok: true, dimension: probe.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function getEmbeddingHealth(): Promise<EmbeddingHealth> {
  if (cachedEmbeddingHealth && Date.now() - cachedEmbeddingHealth.at < EMBEDDING_HEALTH_TTL_MS) {
    return cachedEmbeddingHealth.value;
  }
  const value = await probeEmbeddingHealth();
  cachedEmbeddingHealth = { value, at: Date.now() };
  return value;
}


// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

const CHUNK_SIZE = env.RAG_CHUNK_SIZE; // characters per chunk
const CHUNK_OVERLAP = env.RAG_CHUNK_OVERLAP; // overlap between chunks

/**
 * Find the best end position for a chunk, preferring paragraph or sentence boundaries.
 */
function findChunkEnd(text: string, start: number): number {
  const rawEnd = start + CHUNK_SIZE;
  if (rawEnd >= text.length) return text.length;

  const minEnd = start + CHUNK_SIZE / 2;

  // Try to break at paragraph boundary
  const paragraphBreak = text.lastIndexOf("\n\n", rawEnd);
  if (paragraphBreak > minEnd) return paragraphBreak;

  // Try sentence boundary
  const sentenceBreak = text.lastIndexOf(". ", rawEnd);
  if (sentenceBreak > minEnd) return sentenceBreak + 1;

  return rawEnd;
}

/**
 * Split text into overlapping chunks at paragraph/sentence boundaries.
 */
export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = findChunkEnd(text, start);
    const chunk = text.slice(start, end).trim();

    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    const nextStart = end - CHUNK_OVERLAP;
    // Ensure forward progress
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Embedding pipeline
// ---------------------------------------------------------------------------

/**
 * Chunk and embed a coaching material, storing results in document_chunks.
 * Replaces any existing chunks for this material.
 */
export async function embedCoachingMaterial(material: CoachingMaterial): Promise<void> {
  try {
    const chunks = chunkText(material.content);
    if (chunks.length === 0) return;

    logger.info(
      { materialId: material.id, chunkCount: chunks.length },
      "[rag] Embedding coaching material",
    );

    // Prefix chunks with title for better semantic context
    const textsToEmbed = chunks.map(
      (chunk, i) =>
        i === 0
          ? `${material.title}: ${chunk}`
          : chunk,
    );

    const embeddings = await generateEmbeddings(textsToEmbed);
    trackEmbeddingUsage(material.userId, textsToEmbed.length);

    // Replace old chunks with new ones transactionally, so a failure
    // doesn't leave the material with zero chunks or in an inconsistent state.
    await storage.coaching.replaceChunks(
      material.id,
      chunks.map((content, i) => ({
        materialId: material.id,
        userId: material.userId,
        content,
        chunkIndex: i,
        embedding: embeddings[i],
      })),
    );

    // Invalidate cached retrievals for this user so freshly-embedded
    // material is discoverable on the next query.
    clearRagCache(material.userId);

    logger.info(
      { materialId: material.id, chunkCount: chunks.length },
      "[rag] Finished embedding coaching material",
    );
  } catch (error) {
    logger.error(
      { err: error, materialId: material.id },
      "[rag] Failed to embed coaching material",
    );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

const TOP_K = 6; // Number of chunks to retrieve

// Short-TTL cache for RAG retrieval results. Collapses bursts where the
// context-building pipeline issues identical lookups for the same user/query
// (e.g. rapid chat messages or bulk workout creation). Invalidated per-user
// whenever new coaching material is embedded.
const RAG_CACHE_TTL_MS = 120_000;
const MAX_RAG_CACHE_ENTRIES = 2_000;
type CachedRagResult = { chunks: string[]; at: number };
const ragCache = new Map<string, CachedRagResult>();

function setRagCache(key: string, chunks: string[]) {
  if (ragCache.size >= MAX_RAG_CACHE_ENTRIES) {
    const oldestKey = ragCache.keys().next().value;
    if (oldestKey) ragCache.delete(oldestKey);
  }
  ragCache.set(key, { chunks, at: Date.now() });
}

function ragCacheKey(userId: string, query: string, topK: number): string {
  return `${userId}::${topK}::${query}`;
}

export function clearRagCache(userId?: string): void {
  if (!userId) {
    ragCache.clear();
    return;
  }
  const prefix = `${userId}::`;
  for (const key of ragCache.keys()) {
    if (key.startsWith(prefix)) ragCache.delete(key);
  }
}

/**
 * Retrieve the most relevant coaching material chunks for a given query.
 * Returns chunk content strings ordered by relevance.
 */
export async function retrieveRelevantChunks(
  userId: string,
  query: string,
  topK: number = TOP_K,
): Promise<string[]> {
  const key = ragCacheKey(userId, query, topK);
  const cached = ragCache.get(key);
  if (cached && Date.now() - cached.at < RAG_CACHE_TTL_MS) {
    logger.debug({ userId, topK, cacheHit: true }, "[rag] Returning cached chunks");
    return cached.chunks;
  }

  const queryEmbedding = await generateEmbedding(query);
  trackEmbeddingUsage(userId, 1);
  logger.info({ userId, queryDim: queryEmbedding.length, topK }, "[rag] Searching chunks by embedding");
  const chunks = await storage.coaching.searchChunksByEmbedding(userId, queryEmbedding, topK);
  logger.info({ userId, found: chunks.length }, "[rag] Search returned chunks");
  const content = chunks.map((c) => c.content);
  setRagCache(key, content);
  return content;
}

export async function getRagStatus(userId: string) {
  const materials = await storage.coaching.listCoachingMaterials(userId);
  const chunkCounts = await storage.coaching.getChunkCountsByMaterial(userId);
  const chunkMap = new Map(chunkCounts.map((c) => [c.materialId, c]));

  const hasApiKey = Boolean(env.GEMINI_API_KEY);
  let storedDimension: number | null = null;
  try {
    storedDimension = await storage.coaching.getStoredEmbeddingDimension(userId);
  } catch (err) {
    logger.warn({ err, userId }, "[rag] Failed to read stored embedding dimension");
  }

  const materialStatus = materials.map((m) => {
    const chunks = chunkMap.get(m.id);
    return {
      id: m.id,
      title: m.title,
      type: m.type,
      contentLength: m.content.length,
      chunkCount: chunks?.chunkCount ?? 0,
      hasEmbeddings: chunks?.hasEmbeddings ?? false,
    };
  });

  const totalChunks = chunkCounts.reduce((sum, c) => sum + c.chunkCount, 0);
  const allEmbedded = materials.length > 0 && materials.every((m) => chunkMap.get(m.id)?.hasEmbeddings);

  const embeddingApiStatus: EmbeddingHealth = hasApiKey
    ? await getEmbeddingHealth()
    : { ok: false };

  return {
    hasApiKey,
    totalMaterials: materials.length,
    totalChunks,
    allEmbedded,
    materials: materialStatus,
    storedDimension,
    expectedDimension: EMBEDDING_DIMENSIONS,
    dimensionMismatch: storedDimension !== null && storedDimension !== EMBEDDING_DIMENSIONS,
    embeddingApi: embeddingApiStatus,
  };
}

export async function reembedAllMaterials(userId: string) {
  const materials = await storage.coaching.listCoachingMaterials(userId);
  const errors: string[] = [];
  let count = 0;

  const limit = pLimit(REEMBED_CONCURRENCY);
  const results = await Promise.allSettled(
    materials.map((material) =>
      limit(() => embedCoachingMaterial(material).then(() => material))
    )
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      count++;
    } else {
      const err: unknown = result.reason;
      // We map directly with index, so we can reliably get the failed material
      const material = materials[i];
      errors.push(`${material.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { success: true, materialsProcessed: count, errors };
}
