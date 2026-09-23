import type { GenerateContentResponse } from "@google/genai";

import { getAiClient } from "../ai/geminiSdk";
import { retryWithBackoff } from "../ai/retry";
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
 * Generate an embedding vector for a text string using Gemini's embedding model.
 * Returns a 3072-dimensional float array.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
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
  );
  const values = response.embeddings?.[0]?.values;
  if (!values || values.length === 0) {
    throw new Error("Empty embedding returned from Gemini");
  }
  writeEmbeddingCache(key, values);
  return values;
}

/**
 * Generate embeddings for multiple texts in batch.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  // Process in parallel batches of 5 to avoid rate limits
  const batchSize = 5;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await Promise.all(batch.map(generateEmbedding));
    results.push(...embeddings);
    // Small delay between batches to avoid burst rate-limiting
    if (i + batchSize < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  return results;
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
  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;
  // Fire-and-forget — recordAiUsage already catches internally
  void recordAiUsage(userId, model, feature, inputTokens, outputTokens);
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
