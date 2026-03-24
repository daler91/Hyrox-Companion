import { env } from "../env";
import { logger } from "../logger";
import { GoogleGenAI } from "@google/genai";

export const GEMINI_MODEL = "gemini-2.5-flash-lite";

let _ai: GoogleGenAI | null = null;
export function getAiClient(): GoogleGenAI {
  if (!_ai) {
    _ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY || "" });
  }
  return _ai;
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

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = 4,
  baseDelayMs: number = 2000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries && isRetryableError(error)) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        logger.warn({ err: error }, `[gemini] ${label} attempt ${attempt + 1} failed (retrying in ${delay}ms)`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        break;
      }
    }
  }
  throw lastError;
}

export function truncate(text: string, maxLen: number = 500): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

const EMBEDDING_MODEL = "gemini-embedding-001";

/** Expected dimension count for the current embedding model. */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Generate an embedding vector for a text string using Gemini's embedding model.
 * Returns a 768-dimensional float array.
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
