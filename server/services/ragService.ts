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

// What the athlete sees when the probe fails. The provider's exception text is
// operator detail they cannot act on, so it goes to the log, not the response.
// S6 (CODEBASE_ANALYSIS_2026-10-03)
export const EMBEDDING_UNAVAILABLE_MESSAGE =
  "Document search is temporarily unavailable. Your materials are saved and will be used again once it is back.";

async function probeEmbeddingHealth(): Promise<EmbeddingHealth> {
  try {
    const probe = await generateEmbedding("test");
    return { ok: true, dimension: probe.length };
  } catch (err) {
    // The probe embeds the literal "test"; `err` is the provider's error.
    // bearer:disable javascript_lang_logger_leak
    logger.error({ err }, "[rag] Embedding provider health probe failed");
    return { ok: false, error: EMBEDDING_UNAVAILABLE_MESSAGE };
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

    // Prefix the first chunk with the title for better semantic context
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

    // The material may have been deleted while it was being embedded. The
    // delete route purges its chunks inline, but a purge that ran before
    // replaceChunks committed missed these rows, and nothing else removed them
    // before the nightly prune. So re-check AFTER the write: a delete that
    // commits later is followed by the route's own purge, which then sees
    // them. D38 (CODEBASE_ANALYSIS_2026-10-03)
    const stillExists = await storage.coaching.getCoachingMaterial(material.id, material.userId);
    if (!stillExists) {
      await storage.coaching.deleteChunksByMaterialId(material.id, material.userId);
      clearRagCache(material.userId);
      // An opaque material id; no material content.
      // bearer:disable javascript_lang_logger_leak
      logger.info({ materialId: material.id }, "[rag] Material deleted while embedding; purged its chunks");
      return;
    }

    // The new chunks already changed the athlete's retrieval version, so no
    // replica serves a retrieval cached before them (AI34); this frees this
    // replica's stale entries early.
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

// Short-TTL cache for RAG retrieval results. Collapses repeats of the same
// lookup for the same user/query (a regenerated reply, back-to-back auto-coach
// runs) and saves the embedding call and the four reads behind it.
//
// Process-local, and keyed on the athlete's retrieval version
// (storage.coaching.getRetrievalVersion), which every material create, edit,
// delete and re-embed changes, on whichever replica it happened: an entry can
// only be served while the data it was read from is unchanged, so a deleted
// material can't keep surfacing from another replica's cache (AI34).
//
// It used to be shared through `server_runtime_cache` as well, which wrote a
// row of coaching excerpts to the main DB on every RAG turn for a near-zero
// hit rate, and those rows stayed until the daily expiry sweep (AI35).
// AI34, AI35 (CODEBASE_ANALYSIS_2026-10-03)
const RAG_CACHE_TTL_MS = 120_000;
const MAX_RAG_CACHE_ENTRIES = 2_000;

/** A retrieved excerpt, and the title of the material it came from. */
export interface RetrievedChunk {
  content: string;
  /** Null when the material's title couldn't be read. */
  source: string | null;
}

type CachedRagResult = { chunks: RetrievedChunk[]; at: number };
const ragCache = new Map<string, CachedRagResult>();

function setRagCache(key: string, chunks: RetrievedChunk[]) {
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
function getRagCache(key: string): RetrievedChunk[] | undefined {
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

function ragCacheKey(userId: string, version: string, query: string, topK: number): string {
  const queryKey = `${version}::${topK}::${query}`;
  return `${ragCachePrefix(userId)}${hashRuntimeKey(queryKey)}`;
}

function ragCachePrefix(userId: string): string {
  return `rag:${hashRuntimeKey(userId)}:`;
}

/**
 * Drop this replica's cached retrievals, for one user or all. Not needed for
 * correctness (the retrieval version is, AI34): it frees entries no lookup
 * can match any more.
 */
export function clearRagCache(userId?: string): void {
  if (!userId) {
    ragCache.clear();
    return;
  }
  evictLocalRagEntries(ragCachePrefix(userId));
}

function evictLocalRagEntries(prefix: string): void {
  for (const key of ragCache.keys()) {
    if (key.startsWith(prefix)) ragCache.delete(key);
  }
}

/**
 * Remove every cached retrieval for one user, and wait for the shared
 * delete: account erasure must know the excerpts of the athlete's coaching
 * materials are gone. Retrieval no longer writes `server_runtime_cache`
 * (AI35), but rows a deploy before that wrote stay until the daily expiry
 * sweep, so erasure still deletes them. P13 (CODEBASE_ANALYSIS_2026-10-03)
 */
export async function purgeRagCacheForUser(userId: string): Promise<void> {
  const prefix = ragCachePrefix(userId);
  evictLocalRagEntries(prefix);
  await deleteRuntimeCachePrefix(prefix);
}

/**
 * The athlete's retrieval version, or null when it can't be read: the lookup
 * then runs uncached rather than risk serving an entry the version would have
 * ruled out.
 */
async function retrievalVersion(userId: string): Promise<string | null> {
  try {
    return await storage.coaching.getRetrievalVersion(userId);
  } catch (err) {
    // userId is an opaque uuid and err a DB failure; no material content.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err, userId }, "[rag] Failed to read the retrieval version — retrieving uncached");
    return null;
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

/**
 * The titles to cite chunks by, keyed by the ids of the athlete's materials
 * that still exist on the main DB. Null when the read fails, which leaves the
 * excerpts uncited rather than failing the retrieval.
 */
async function materialTitles(
  userId: string,
  chunks: readonly { materialId: string }[],
): Promise<Map<string, string> | null> {
  try {
    return await storage.coaching.getMaterialTitles(userId, [...new Set(chunks.map((c) => c.materialId))]);
  } catch (err) {
    // userId is an opaque uuid and err a DB failure; no material content.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err, userId }, "[rag] Failed to read material titles — excerpts go uncited");
    return null;
  }
}

export async function retrieveRelevantChunks(
  userId: string,
  query: string,
  topK: number = TOP_K,
): Promise<RetrievedChunk[]> {
  // Read before anything the retrieval reads, so an entry is never older
  // than the version it is filed under.
  const version = await retrievalVersion(userId);
  const key = version === null ? null : ragCacheKey(userId, version, query, topK);
  const cached = key === null ? undefined : getRagCache(key);
  if (cached) {
    logger.debug({ userId, topK, cacheHit: true }, "[rag] Returning cached chunks");
    return cached;
  }

  // Pin the athlete's stated principles ahead of the semantic search.
  //
  // Without this, "no sled at my gym" reaches the coach only when the query
  // happens to embed near it — and stops reaching it at all once the athlete's
  // corpus grows past topK, or the distance cut-off below drops it. Guidance
  // the athlete wrote as always-true should not drop out of the prompt because
  // they later uploaded a PDF, or asked about something else.
  //
  // The pin is taken OUT of the topK budget rather than added to it, so prompt
  // size and cost are unchanged — this changes which chunks are chosen, not how
  // many.
  //
  // Perf: the pinned-chunk DB reads (two sequential queries) and the embedding
  // API call are independent, so run them concurrently — the chat turn waits
  // for max(DB, embed) instead of DB + embed (saves the pinned-read latency,
  // typically tens of ms, on every uncached retrieval).
  // listPinnedPrincipleChunks never rejects, so Promise.all can't mask it.
  const [pinned, queryEmbedding] = await Promise.all([
    listPinnedPrincipleChunks(userId, Math.min(MAX_PINNED_PRINCIPLE_CHUNKS, topK)),
    generateEmbedding(query),
  ]);
  const pinnedIds = new Set(pinned.map((c) => c.id));

  trackEmbeddingUsage(userId, 1);
  // An opaque uuid and three counts. The query text and the retrieved chunk
  // contents are deliberately never logged.
  // bearer:disable javascript_lang_logger_leak
  logger.info({ userId, queryDim: queryEmbedding.length, topK, pinned: pinned.length }, "[rag] Searching chunks by embedding");
  // Over-fetch by the pinned count so dedupe cannot leave us short of topK.
  const found = await storage.coaching.searchChunksByEmbedding(userId, queryEmbedding, topK);
  // The nearest six are not necessarily near: "thanks!" or an off-topic
  // question still fetched six. Pinned principles are exempt.
  const maxDistance = env.RAG_MAX_COSINE_DISTANCE;
  const chunks = found.filter((chunk) => chunk.distance <= maxDistance);
  // An opaque uuid, counts and distances: never the query or chunk content.
  // bearer:disable javascript_lang_logger_leak
  logger.info(
    { userId, found: found.length, kept: chunks.length, bestDistance: found[0]?.distance, maxDistance },
    "[rag] Search returned chunks",
  );
  const candidates = [...pinned, ...chunks.filter((c) => !pinnedIds.has(c.id))];
  const titles = await materialTitles(userId, candidates);
  // document_chunks can live in a separate database with no FK to
  // coaching_materials, so a chunk can outlive its material (an embed job
  // that finished after the delete route's purge, or a purge that failed)
  // until the nightly prune. The titles read is the main-DB existence check:
  // a chunk whose material it did not return never reaches the prompt. A
  // failed read keeps the chunks, uncited, and is not cached, so the next
  // retrieval checks again. D38 (CODEBASE_ANALYSIS_2026-10-03)
  const live = titles ? candidates.filter((c) => titles.has(c.materialId)) : candidates;
  const retrieved = live
    .slice(0, topK)
    .map((c) => ({ content: c.content, source: titles?.get(c.materialId) ?? null }));
  if (titles && key !== null) setRagCache(key, retrieved);
  return retrieved;
}

export async function getRagStatus(userId: string) {
  // ⚡ Bolt Performance Optimization: these three reads are mutually
  // independent (materials comes from the main `db` pool; chunk counts and
  // stored dimension both come from `vectorPool` but scan unrelated
  // aggregates over document_chunks) — none depends on another's result, so
  // awaiting them sequentially just triples the round-trip latency for no
  // reason. This route is UI-polled (see cache comment above), so the
  // latency saved here is paid on every poll, not just once.
  const [materials, chunkCounts, storedDimension] = await Promise.all([
    storage.coaching.listCoachingMaterials(userId),
    storage.coaching.getChunkCountsByMaterial(userId),
    storage.coaching.getStoredEmbeddingDimension(userId).catch((err) => {
      // userId is an opaque uuid and err is a DB/connection failure; neither
      // carries the athlete's material content. Same shape already suppressed
      // above in listPinnedPrincipleChunks.
      // bearer:disable javascript_lang_logger_leak
      logger.warn({ err, userId }, "[rag] Failed to read stored embedding dimension");
      return null;
    }),
  ]);
  const chunkMap = new Map(chunkCounts.map((c) => [c.materialId, c]));

  const hasApiKey = Boolean(env.GEMINI_API_KEY);

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
    : { ok: false, error: EMBEDDING_UNAVAILABLE_MESSAGE };

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
