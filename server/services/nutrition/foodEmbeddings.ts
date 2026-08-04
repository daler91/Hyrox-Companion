import { createHash } from "node:crypto";

import { foods } from "@shared/schema";
import { inArray } from "drizzle-orm";

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
  const brandSuffix = food.brand ? ` ${food.brand}` : "";
  return `${food.name}${brandSuffix}`.trim();
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
 * GDPR purge: remove the embeddings of specific foods (a deleted user's private
 * custom foods) from the vector DB. `food_embeddings` has no user column and no
 * cross-DB FK, so the caller must supply the food-id list — captured from the
 * main DB BEFORE the user-delete cascade nulls the ownership column. Idempotent
 * (deleting an absent id is a no-op), so callers may safely run it twice
 * (pre-deletion fail-loud pass + post-deletion catch-up pass).
 */
export async function deleteFoodEmbeddingsByFoodIds(foodIds: readonly string[]): Promise<void> {
  if (foodIds.length === 0) return;
  await vectorPool.query(`DELETE FROM food_embeddings WHERE food_id = ANY($1)`, [foodIds]);
}

// Batch size for the dangling-embedding existence check against the main DB.
const PRUNE_CHECK_BATCH = 500;

/**
 * Self-healing sweep: delete embeddings whose `foods` row no longer exists —
 * deleted accounts' purged private customs (including any the account-deletion
 * route's best-effort second purge missed), the migration-0081 orphan cleanup,
 * and any future food-deletion path. Runs from the embedding backfill cron.
 * Cross-DB (embeddings on vectorPool, foods on the main DB), so existence is
 * checked in bounded batches rather than a join.
 */
export async function pruneDanglingFoodEmbeddings(): Promise<{ pruned: number }> {
  const existing = await vectorPool.query<{ food_id: string }>(
    `SELECT food_id FROM food_embeddings`,
  );
  const ids = existing.rows.map((row) => row.food_id);
  if (ids.length === 0) return { pruned: 0 };

  const live = new Set<string>();
  for (let i = 0; i < ids.length; i += PRUNE_CHECK_BATCH) {
    const batch = ids.slice(i, i + PRUNE_CHECK_BATCH);
    const rows = await db.select({ id: foods.id }).from(foods).where(inArray(foods.id, batch));
    for (const row of rows) live.add(row.id);
  }

  const dangling = ids.filter((id) => !live.has(id));
  if (dangling.length > 0) {
    await deleteFoodEmbeddingsByFoodIds(dangling);
    // bearer:disable javascript_lang_logger_leak — count and static context only, no PII
    logger.info(
      { context: "nutrition", pruned: dangling.length },
      "Pruned dangling food embeddings",
    );
  }
  return { pruned: dangling.length };
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
  const rows: { id: string; vectorStr: string; hash: string }[] = [];
  for (const [index, item] of pending.entries()) {
    const vector = vectors[index];
    if (!vector || vector.length === 0) continue;
    rows.push({ id: item.id, vectorStr: `[${vector.join(",")}]`, hash: item.hash });
  }

  // Upsert every row in a single round trip instead of one query per food:
  // up to MAX_BATCH (200) sequential INSERTs collapse into one multi-row
  // VALUES statement, cutting backfill latency from O(N) round trips to O(1).
  if (rows.length > 0) {
    const placeholders: string[] = [];
    const params: unknown[] = [];
    rows.forEach((row, i) => {
      const base = i * 4;
      placeholders.push(
        `($${base + 1}, $${base + 2}::vector(${EMBEDDING_DIMENSIONS}), $${base + 3}, $${base + 4}, now())`,
      );
      params.push(row.id, row.vectorStr, EMBEDDING_MODEL, row.hash);
    });
    await vectorPool.query(
      `INSERT INTO food_embeddings (food_id, embedding, model, text_hash, updated_at)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (food_id) DO UPDATE SET
         embedding = EXCLUDED.embedding, model = EXCLUDED.model,
         text_hash = EXCLUDED.text_hash, updated_at = now()`,
      params,
    );
  }

  const embedded = rows.length;
  logger.info(
    { context: "nutrition", embedded, pending: pending.length },
    "Food embedding backfill batch",
  );
  return { embedded };
}
