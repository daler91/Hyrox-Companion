import { createHash } from "node:crypto";

import { foods } from "@shared/schema";

import { db } from "../../db";
import { EMBEDDING_DIMENSIONS, generateEmbeddings } from "../../gemini/client";
import { logger } from "../../logger";
import { vectorPool } from "../../vectorDb";

/**
 * Vector storage for semantic food search (Phase 2). Owns the `food_embeddings`
 * table on the vector pool (created in `server/maintenance.ts`): a shared,
 * non-per-user embedding per cached `foods` row, keyed by foodId. The backfill cron
 * (`server/cron.ts`) populates it in bounded batches; `searchFoodIdsByEmbedding`
 * reads it at query time. Cross-DB to the main `foods` table, so visibility is
 * re-checked when ids are resolved back to rows — never trust an id from here alone.
 *
 * All functions assume the caller has already gated on the feature flag + AI being
 * enabled (embedding generation throws when AI is off).
 */

const EMBEDDING_MODEL = "gemini-embedding-001";
// Per backfill run: bound the embeddings generated (cost/time) and the candidate
// scan. The cron drains any backlog over multiple runs.
const MAX_BATCH = 200;
const CANDIDATE_SCAN_LIMIT = 5000;

/** The text embedded for a food: its name plus brand (brand disambiguates products). */
export function foodEmbeddingText(food: { name: string; brand: string | null }): string {
  return `${food.name}${food.brand ? ` ${food.brand}` : ""}`.trim();
}

/** Stable hash of the embedded text, so the backfill can skip unchanged foods. */
export function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/**
 * Pure selection: from candidate foods and the set of already-embedded
 * (foodId → text_hash), pick up to `limit` whose embedded text is missing or stale.
 * Extracted from the I/O so it's unit-testable.
 */
export function selectFoodsToEmbed(
  candidates: readonly { id: string; name: string; brand: string | null }[],
  existingHash: ReadonlyMap<string, string>,
  limit: number,
): { id: string; text: string; hash: string }[] {
  const pending: { id: string; text: string; hash: string }[] = [];
  for (const food of candidates) {
    const text = foodEmbeddingText(food);
    if (!text) continue;
    const hash = textHash(text);
    if (existingHash.get(food.id) !== hash) pending.push({ id: food.id, text, hash });
    if (pending.length >= limit) break;
  }
  return pending;
}

/** Top-K foodIds by cosine similarity to the query embedding (ANN order preserved).
 *  Mirrors CoachingStorage.searchChunksByEmbedding's halfvec cast so the HNSW index
 *  is used. Not user-scoped — foods are shared; the caller re-checks visibility. */
export async function searchFoodIdsByEmbedding(
  embedding: number[],
  topK: number,
): Promise<string[]> {
  const embeddingStr = `[${embedding.join(",")}]`;
  const result = await vectorPool.query<{ food_id: string }>(
    `SELECT food_id
       FROM food_embeddings
      WHERE embedding IS NOT NULL
      ORDER BY embedding::halfvec(${EMBEDDING_DIMENSIONS}) <=> $1::halfvec(${EMBEDDING_DIMENSIONS})
      LIMIT $2`,
    [embeddingStr, topK],
  );
  return result.rows.map((row) => row.food_id);
}

/**
 * Embed a bounded batch of cached foods that lack a current embedding, upserting
 * them into `food_embeddings`. Returns how many were embedded. Best-effort — assumes
 * the caller gated on the flag + AI; throws only on an unexpected DB/AI failure (the
 * cron swallows it).
 */
export async function embedMissingFoods(limit = MAX_BATCH): Promise<{ embedded: number }> {
  const existing = await vectorPool.query<{ food_id: string; text_hash: string }>(
    `SELECT food_id, text_hash FROM food_embeddings`,
  );
  const existingHash = new Map(existing.rows.map((row) => [row.food_id, row.text_hash]));

  const candidates = await db
    .select({ id: foods.id, name: foods.name, brand: foods.brand })
    .from(foods)
    .limit(CANDIDATE_SCAN_LIMIT);

  const pending = selectFoodsToEmbed(candidates, existingHash, limit);
  if (pending.length === 0) return { embedded: 0 };

  const vectors = await generateEmbeddings(pending.map((p) => p.text));
  let embedded = 0;
  for (const [index, item] of pending.entries()) {
    const vector = vectors[index];
    if (!vector || vector.length === 0) continue;
    await vectorPool.query(
      `INSERT INTO food_embeddings (food_id, embedding, model, text_hash, updated_at)
       VALUES ($1, $2::vector(${EMBEDDING_DIMENSIONS}), $3, $4, now())
       ON CONFLICT (food_id) DO UPDATE SET
         embedding = EXCLUDED.embedding, model = EXCLUDED.model,
         text_hash = EXCLUDED.text_hash, updated_at = now()`,
      [item.id, `[${vector.join(",")}]`, EMBEDDING_MODEL, item.hash],
    );
    embedded += 1;
  }
  logger.info(
    { context: "nutrition", embedded, pending: pending.length },
    "Food embedding backfill batch",
  );
  return { embedded };
}
