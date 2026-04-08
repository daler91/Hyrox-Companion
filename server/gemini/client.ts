import { type GenerateContentResponse,GoogleGenAI } from "@google/genai";

import { AI_CALL_TIMEOUT_MS,AI_REQUEST_TIMEOUT_MS } from "../constants";
import { env } from "../env";
import { logger } from "../logger";
import { recordAiUsage } from "../services/aiUsageService";
import {
  assertBreakerClosed,
  CircuitBreakerOpenError,
  recordBreakerFailure,
  recordBreakerSuccess,
} from "./circuitBreaker";

export const GEMINI_MODEL = env.GEMINI_MODEL;
export const GEMINI_SUGGESTIONS_MODEL = env.GEMINI_SUGGESTIONS_MODEL;

let _ai: GoogleGenAI | null = null;
export function getAiClient(): GoogleGenAI {
  if (!_ai) {
    if (!env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is required for AI features");
    }
    _ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return _ai;
}

/** Race a promise against a timeout; rejects with a descriptive error on expiry. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timerId: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timerId)),
    new Promise<never>((_, reject) => {
      timerId = setTimeout(() => reject(new Error(`AI call timed out after ${ms}ms (${label})`)), ms);
    }),
  ]);
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("429") || msg.includes("rate limit")) return true;
    if (
      msg.includes("500") ||
      msg.includes("503") ||
      msg.includes("internal server error")
    )
      return true;
    if (
      msg.includes("network") ||
      msg.includes("econnreset") ||
      msg.includes("timeout") ||
      msg.includes("fetch failed")
    )
      return true;
  }
  return false;
}

function shouldRetry(error: unknown, attempt: number, maxRetries: number, baseDelayMs: number, deadline: number): number | false {
  if (attempt >= maxRetries || !isRetryableError(error)) return false;
  const delay = baseDelayMs * Math.pow(2, attempt);
  if (Date.now() + delay >= deadline) return false;
  return delay;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = 4,
  baseDelayMs: number = 2000,
  budgetMs: number = AI_REQUEST_TIMEOUT_MS,
): Promise<T> {
  // Fast-fail when the breaker is open so prolonged outages don't amplify
  // latency across every caller (CODEBASE_AUDIT.md §5). Breaker open error
  // is not retryable — bail immediately so upstream queues can back off.
  assertBreakerClosed();

  const deadline = Date.now() + budgetMs;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (Date.now() >= deadline) {
      throw (lastError instanceof Error ? lastError : new Error(`AI request budget exhausted for ${label}`));
    }
    try {
      const remaining = deadline - Date.now();
      const result = await withTimeout(fn(), Math.min(remaining, AI_CALL_TIMEOUT_MS), label);
      recordBreakerSuccess();
      return result;
    } catch (error) {
      lastError = error;
      // A breaker-open error thrown mid-flight (from nested retryWithBackoff
      // call) should propagate without counting again.
      if (error instanceof CircuitBreakerOpenError) throw error;
      const delay = shouldRetry(error, attempt, maxRetries, baseDelayMs, deadline);
      if (delay === false) break;
      logger.warn({ err: error }, `[gemini] ${label} attempt ${attempt + 1} failed (retrying in ${delay}ms)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // Only count a logical failure (after all retries exhausted) against the
  // breaker — individual retry attempts should not accelerate tripping.
  recordBreakerFailure();
  throw lastError;
}

export function truncate(text: string, maxLen: number = 500): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

const EMBEDDING_MODEL = "gemini-embedding-001";

/** Expected dimension count for the current embedding model. */
export const EMBEDDING_DIMENSIONS = 3072;

/**
 * Generate an embedding vector for a text string using Gemini's embedding model.
 * Returns a 3072-dimensional float array.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await retryWithBackoff(
    () =>
      getAiClient().models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
      }),
    "embedding",
  );
  const values = response.embeddings?.[0]?.values;
  if (!values || values.length === 0) {
    throw new Error("Empty embedding returned from Gemini");
  }
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
// Usage tracking helpers — fire-and-forget recording after Gemini calls
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
 * Record embedding usage. Embeddings have input tokens only (no output).
 * Estimates ~6 tokens per text for the embedding model.
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
