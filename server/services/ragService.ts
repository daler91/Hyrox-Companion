import type { CoachingMaterial } from "@shared/schema";
import pLimit from "p-limit";

import { env } from "../env";
import { EMBEDDING_DIMENSIONS,generateEmbedding, generateEmbeddings, trackEmbeddingUsage } from "../gemini/client";
import { logger } from "../logger";
import { deleteRuntimeCachePrefix, getRuntimeCache, hashRuntimeKey, setRuntimeCache } from "../sharedRuntimeState";
import { storage } from "../storage";

// Bound concurrent Gemini + DB writes during bulk re-embed so a large
// tenant cannot burst-load the embedding provider or DB pool
// (CODEBASE_AUDIT.md §3).
const REEMBED_CONCURRENCY = 3;

// Hard cap on chunks per material so an unusually large document cannot
// spike memory (embedding vectors are 1536–3072 floats each) or burn the
// user's Gemini budget in one request (W7). At CHUNK_SIZE=600 this still
// covers ~1.5MB source documents comfortably.
const MAX_CHUNKS_PER_MATERIAL = 3000;

// Cache the embedding-provider health probe so UI polling of getRagStatus
// does not issue a live generateEmbedding("test") call on every request
// (CODEBASE_AUDIT.md §3).
type EmbeddingHealth = { ok: boolean; dimension?: number; error?: string };
const EMBEDDING_HEALTH_TTL_MS = 5 * 60_000;
const EMBEDDING_HEALTH_CACHE_KEY = "rag-health:embedding";
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

  if (env.NODE_ENV !== "test") {
    try {
      const shared = await getRuntimeCache<EmbeddingHealth>(EMBEDDING_HEALTH_CACHE_KEY);
      if (shared) {
        cachedEmbeddingHealth = { value: shared, at: Date.now() };
        return shared;
      }
    } catch (err) {
      logger.warn({ err }, "[rag] Failed to read shared embedding health cache");
    }
  }

  const value = await probeEmbeddingHealth();
  cachedEmbeddingHealth = { value, at: Date.now() };
  if (env.NODE_ENV !== "test") {
    void setRuntimeCache(EMBEDDING_HEALTH_CACHE_KEY, value, EMBEDDING_HEALTH_TTL_MS).catch((err: unknown) => {
      logger.warn({ err }, "[rag] Failed to write shared embedding health cache");
    });
  }
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

    if (chunks.length > MAX_CHUNKS_PER_MATERIAL) {
      const message = `Coaching material "${material.title}" produced ${chunks.length} chunks (limit ${MAX_CHUNKS_PER_MATERIAL}). Split the document into smaller files or increase RAG_CHUNK_SIZE.`;
      logger.error({ materialId: material.id, chunkCount: chunks.length }, message);
      throw new Error(message);
    }

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

    // S7: de-duplicate identical chunk texts before embedding so repeated
    // boilerplate (or content pasted twice) is embedded once and the vector
    // reused for every position. The generateEmbedding cache collapses repeats
    // across calls, but identical strings inside a single parallel batch would
    // otherwise each hit the provider. Usage tracking reflects the deduped count.
    const uniqueTexts = [...new Set(textsToEmbed)];
    const uniqueEmbeddings = await generateEmbeddings(uniqueTexts);
    const embeddingByText = new Map(uniqueTexts.map((text, i) => [text, uniqueEmbeddings[i]]));
    trackEmbeddingUsage(material.userId, uniqueTexts.length);

    const embeddings = textsToEmbed.map((text) => embeddingByText.get(text)!);

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
/**
 * How many of those may be reserved for pinned `principles` chunks. Bounded so
 * an athlete who pastes a long document as "principles" cannot crowd the
 * semantic search out of its own budget.
 */
const MAX_PINNED_PRINCIPLE_CHUNKS = 3;

// Short-TTL cache for RAG retrieval results. Collapses bursts where the
// context-building pipeline issues identical lookups for the same user/query
// (e.g. rapid chat messages or bulk workout creation). Invalidated per-user
// whenever new coaching material is embedded.
const RAG_CACHE_TTL_MS = 120_000;
const MAX_RAG_CACHE_ENTRIES = 2_000;
type CachedRagResult = { chunks: string[]; at: number };
const ragCache = new Map<string, CachedRagResult>();

function setRagCache(key: string, chunks: string[]) {
  // Delete-then-set so an existing key moves to the tail (most-recently-used).
  ragCache.delete(key);
  if (ragCache.size >= MAX_RAG_CACHE_ENTRIES) {
    // The head is the least-recently-used entry because getRagCache re-inserts
    // on every hit (LRU, W13) — not merely the oldest-inserted (FIFO).
    const oldestKey = ragCache.keys().next().value;
    if (oldestKey) ragCache.delete(oldestKey);
  }
  ragCache.set(key, { chunks, at: Date.now() });
}

// Read with TTL enforcement + LRU bookkeeping: on a live hit, re-insert the
// entry so it becomes most-recently-used and survives eviction under churn
// (W13). `at` is the cache time for TTL and is intentionally not refreshed on
// access, so a hot key still expires on schedule.
function getRagCache(key: string): string[] | undefined {
  const entry = ragCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at >= RAG_CACHE_TTL_MS) {
    ragCache.delete(key);
    return undefined;
  }
  ragCache.delete(key);
  ragCache.set(key, entry);
  return entry.chunks;
}

function ragCacheKey(userId: string, query: string, topK: number): string {
  const queryKey = `${topK}::${query}`;
  return `${ragCachePrefix(userId)}${hashRuntimeKey(queryKey)}`;
}

function ragCachePrefix(userId: string): string {
  return `rag:${hashRuntimeKey(userId)}:`;
}

export function clearRagCache(userId?: string): void {
  if (!userId) {
    ragCache.clear();
    if (env.NODE_ENV !== "test") {
      void deleteRuntimeCachePrefix("rag:").catch((err: unknown) => {
        logger.warn({ err }, "[rag] Failed to clear shared retrieval cache");
      });
    }
    return;
  }
  const prefix = ragCachePrefix(userId);
  for (const key of ragCache.keys()) {
    if (key.startsWith(prefix)) ragCache.delete(key);
  }
  if (env.NODE_ENV !== "test") {
    void deleteRuntimeCachePrefix(prefix).catch((err: unknown) => {
      logger.warn({ err, userId }, "[rag] Failed to clear shared retrieval cache");
    });
  }
}

/**
 * Retrieve the most relevant coaching material chunks for a given query.
 * Returns chunk content strings ordered by relevance.
 */
/**
 * The athlete's `principles` chunks, or [] if they have none — a two-step read
 * because `coaching_materials` and `document_chunks` can live in different
 * databases (see storage.coaching.listPrincipleMaterialIds).
 *
 * Never throws: a failure here must degrade to an unpinned search rather than
 * take down the chat turn.
 */
async function listPinnedPrincipleChunks(userId: string, limit: number) {
  if (limit <= 0) return [];
  try {
    const materialIds = await storage.coaching.listPrincipleMaterialIds(userId);
    return await storage.coaching.listChunksForMaterials(userId, materialIds, limit);
  } catch (err) {
    // userId is an opaque uuid and err is a DB/connection failure from the
    // two-step read; neither carries the athlete's material content.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err, userId }, "[rag] Failed to load pinned principle chunks — falling back to search only");
    return [];
  }
}

export async function retrieveRelevantChunks(
  userId: string,
  query: string,
  topK: number = TOP_K,
): Promise<string[]> {
  const key = ragCacheKey(userId, query, topK);
  const cached = getRagCache(key);
  if (cached) {
    logger.debug({ userId, topK, cacheHit: true }, "[rag] Returning cached chunks");
    return cached;
  }

  if (env.NODE_ENV !== "test") {
    try {
      const shared = await getRuntimeCache<{ chunks: string[] }>(key);
      if (shared) {
        setRagCache(key, shared.chunks);
        logger.debug({ userId, topK, cacheHit: true, shared: true }, "[rag] Returning cached chunks");
        return shared.chunks;
      }
    } catch (err) {
      logger.warn({ err, userId, topK }, "[rag] Failed to read shared retrieval cache");
    }
  }

  // Pin the athlete's stated principles ahead of the semantic search.
  //
  // Without this, "no sled at my gym" reaches the coach only when the query
  // happens to embed near it — and stops reaching it at all once the athlete's
  // corpus grows past topK, because the search has no similarity threshold and
  // simply returns the nearest six. Guidance the athlete wrote as always-true
  // should not drop out of the prompt because they later uploaded a PDF.
  //
  // The pin is taken OUT of the topK budget rather than added to it, so prompt
  // size and cost are unchanged — this changes which chunks are chosen, not how
  // many.
  const pinned = await listPinnedPrincipleChunks(userId, Math.min(MAX_PINNED_PRINCIPLE_CHUNKS, topK));
  const pinnedIds = new Set(pinned.map((c) => c.id));

  const queryEmbedding = await generateEmbedding(query);
  trackEmbeddingUsage(userId, 1);
  // An opaque uuid and three counts. The query text and the retrieved chunk
  // contents are deliberately never logged.
  // bearer:disable javascript_lang_logger_leak
  logger.info({ userId, queryDim: queryEmbedding.length, topK, pinned: pinned.length }, "[rag] Searching chunks by embedding");
  // Over-fetch by the pinned count so dedupe cannot leave us short of topK.
  const chunks = await storage.coaching.searchChunksByEmbedding(userId, queryEmbedding, topK);
  logger.info({ userId, found: chunks.length }, "[rag] Search returned chunks");
  const content = [...pinned, ...chunks.filter((c) => !pinnedIds.has(c.id))]
    .slice(0, topK)
    .map((c) => c.content);
  setRagCache(key, content);
  if (env.NODE_ENV !== "test") {
    void setRuntimeCache(key, { chunks: content }, RAG_CACHE_TTL_MS).catch((err: unknown) => {
      logger.warn({ err, userId, topK }, "[rag] Failed to write shared retrieval cache");
    });
  }
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
