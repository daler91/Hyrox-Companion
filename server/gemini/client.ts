import type { GenerateContentResponse } from "@google/genai";
import { inChunks, inSequence } from "@shared/inSequence";

import { embeddingBreaker } from "../ai/circuitBreaker";
import { getAiClient } from "../ai/geminiSdk";
import { usageFromGeminiResponse } from "../ai/providers/gemini";
import { type RetryOptions, retryWithBackoff } from "../ai/retry";
import { env } from "../env";
import { recordAiUsage } from "../services/aiUsageService";
import { hashRuntimeKey } from "../sharedRuntimeState";

// The retry core and SDK factory moved to server/ai (A2) so the dependency
// runs gemini -> ai only. Re-exported here so existing importers keep working.
export { getAiClient } from "../ai/geminiSdk";
export { isRetryableError, retryWithBackoff, withTimeout } from "../ai/retry";

export const GEMINI_VISION_MODEL = env.GEMINI_VISION_MODEL;

const EMBEDDING_MODEL = "gemini-embedding-001";

/** Expected dimension count for the current embedding model. */
export const EMBEDDING_DIMENSIONS = 3072;

// Tiny in-process LRU cache for identical embedding lookups. Prevents the
// rag-retrieval health probe, repeated chat queries, and re-embed passes from
// re-billing the same string (S8). Size is bounded so the worst case is a few
// MB of floats per process.
//
// TTL (1h) prevents long-lived processes from serving an embedding that was
// generated under a now-superseded model or after a prompt-engineering
// change (CODEBASE_AUDIT.md Suggestion-4). Expired entries are dropped lazily
// when read, and writes past capacity evict the least-recently-used entries,
// so no background timer is needed.
//
// Deliberately process-local: writing full vectors to the shared runtime
// cache would let attacker-controlled input volume grow server_runtime_cache
// without bound. Nothing writes `embedding:*` keys there, so nothing reads
// them either.
const EMBEDDING_CACHE_MAX_ENTRIES = 256;
const EMBEDDING_CACHE_TTL_MS = 60 * 60 * 1000;
type EmbeddingCacheEntry = { values: number[]; expiresAt: number };
const embeddingCache = new Map<string, EmbeddingCacheEntry>();

function cacheKey(text: string): string {
  // Trim whitespace so leading/trailing padding doesn't partition the cache.
  return `embedding:${EMBEDDING_MODEL}:${hashRuntimeKey(text.trim())}`;
}

function readEmbeddingCache(key: string): number[] | undefined {
  const entry = embeddingCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    embeddingCache.delete(key);
    return undefined;
  }
  // Re-insert to move to the tail (Map iteration order == insertion order).
  embeddingCache.delete(key);
  embeddingCache.set(key, entry);
  return entry.values;
}

function writeEmbeddingCache(key: string, values: number[]): void {
  embeddingCache.delete(key);
  embeddingCache.set(key, { values, expiresAt: Date.now() + EMBEDDING_CACHE_TTL_MS });
  // Over capacity, evict from the head: reads re-insert at the tail, so the
  // head holds the least-recently-used entries.
  while (embeddingCache.size > EMBEDDING_CACHE_MAX_ENTRIES) {
    const firstKey = embeddingCache.keys().next().value;
    if (firstKey === undefined) break;
    embeddingCache.delete(firstKey);
  }
}

// Exported for tests to reset the cache between cases without reloading
// the module.
export function __resetEmbeddingCacheForTests(): void {
  embeddingCache.clear();
}

/**
 * Retry policy for an embedding someone is waiting on: a chat turn's RAG query
 * (embedded before the reply's SSE headers go out), the RAG health probe and
 * semantic food search, each of which has a fallback. They had the default
 * policy, sized for slow reasoning calls (4 retries, 90 s per attempt, 120 s in
 * all), so a degraded embedding endpoint held a chat turn for half a minute to
 * two minutes before it fell back to the legacy materials. An embedding
 * normally answers in well under a second: one quick retry of a 429/5xx, 4 s
 * per attempt and 6 s in all — AI23 (CODEBASE_ANALYSIS_2026-10-03).
 *
 * Its failures still count against embeddingBreaker, which only Gemini
 * embeddings share (AI2): the query and the background jobs call the same
 * endpoint, so a run of failures in either says the same thing about it, and
 * once the breaker opens a chat turn goes straight to its fallback.
 */
const QUERY_EMBEDDING_RETRY: RetryOptions = {
  maxRetries: 1,
  baseDelayMs: 500,
  callTimeoutMs: 4_000,
  budgetMs: 6_000,
};

/**
 * Batches (the coaching-material embed job, re-embedding every material, the
 * food-embedding cron) keep the default policy: they have no fallback, so
 * riding out a slow endpoint beats failing the batch.
 */
const BATCH_EMBEDDING_RETRY: RetryOptions = {};

async function embed(text: string, retry: RetryOptions): Promise<number[]> {
  const key = cacheKey(text);
  const cached = readEmbeddingCache(key);
  if (cached) return cached;

  const response = await retryWithBackoff(
    (signal) =>
      getAiClient().models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
        config: { abortSignal: signal },
      }),
    "embedding",
    // Its own breaker: an embedding incident must not cut off the text
    // provider — AI2 (CODEBASE_ANALYSIS_2026-10-03).
    embeddingBreaker,
    retry,
  );
  const values = response.embeddings?.[0]?.values;
  if (!values || values.length === 0) {
    throw new Error("Empty embedding returned from Gemini");
  }
  writeEmbeddingCache(key, values);
  return values;
}

/**
 * Embed one text for a caller that is waiting on it (a chat turn's RAG query,
 * the RAG health probe, semantic food search), under the short query-time
 * retry policy above. Background work goes through generateEmbeddings.
 * Returns a 3072-dimensional float array.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  return await embed(text, QUERY_EMBEDDING_RETRY);
}

/**
 * Generate embeddings for multiple texts in batch, under the default
 * (background) retry policy.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  // Process in parallel batches of 5 to avoid rate limits
  const batchSize = 5;
  const batches = await inSequence(inChunks(texts, batchSize), async (batch, index) => {
    // Small delay between batches to avoid burst rate-limiting
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return await Promise.all(batch.map((text) => embed(text, BATCH_EMBEDDING_RETRY)));
  });
  return batches.flat();
}

// ---------------------------------------------------------------------------
// Usage tracking helpers — fire-and-forget recording after Gemini SDK calls
// ---------------------------------------------------------------------------

/**
 * Extract token counts from a Gemini response and record usage.
 * Safe to call fire-and-forget — never throws.
 */
export function trackUsageFromResponse(
  userId: string,
  model: string,
  feature: string,
  response: GenerateContentResponse,
): void {
  // The text provider's counting, so thinking tokens are billed here too — AI4
  // (CODEBASE_ANALYSIS_2026-10-03).
  const usage = usageFromGeminiResponse(response);
  // Fire-and-forget — recordAiUsage already catches internally
  void recordAiUsage(userId, model, feature, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0);
}

/**
 * Record embedding usage. Embeddings have input tokens only (no output), and
 * embedContent returns no usageMetadata, so this estimates ~150 tokens per
 * text (an average ~600-character coaching chunk).
 */
export function trackEmbeddingUsage(
  userId: string,
  textCount: number,
): void {
  // Gemini embedding-001 doesn't return usageMetadata in embedContent responses.
  // Estimate: average coaching chunk is ~600 chars ≈ ~150 tokens.
  const estimatedTokens = textCount * 150;
  void recordAiUsage(userId, EMBEDDING_MODEL, "embedding", estimatedTokens, 0);
}
